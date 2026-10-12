import * as fs from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import { GeminiAiValidatorAdapter } from '../src/modules/validation/infrastructure/gemini-ai-validator.adapter';
import { AiValidatorError } from '../src/modules/validation/domain/ai-validator.error';
import { PrepareAiValidationContextService } from '../src/modules/validation/application/prepare-ai-validation-context.service';
import { ValidationSecretRedactorService } from '../src/modules/validation/application/validation-secret-redactor.service';
import {
  MultidayOptions,
  runMultidayBenchmark,
} from '../evaluation/ai-validation/src/multiday-runner';
import {
  Checkpoint,
  createRunIdentity,
  initialCheckpoint,
  validateCheckpoint,
  materializePredictions,
  assertTransition,
} from '../evaluation/ai-validation/src/multiday-checkpoint';
import {
  CheckpointStore,
  checkpointLocation,
} from '../evaluation/ai-validation/src/multiday-store';
import {
  PHASE6_3F,
  assertPhase63fIdentity,
} from '../evaluation/ai-validation/src/phase6-3f-campaign';
import {
  PROVIDER_FAILURE_POLICY,
  isContinuableProviderFailure,
} from '../evaluation/ai-validation/src/provider-failure-policy';
import {
  validateDataset,
  validatePredictions,
} from '../evaluation/ai-validation/src/evaluation.validator';
import { scoreEvaluation } from '../evaluation/ai-validation/src/evaluation.scorer';
import { renderEvaluationReport } from '../evaluation/ai-validation/src/evaluation.report';
import {
  formatCheckpointSummary,
  main,
  parseLiveArguments,
} from '../evaluation/ai-validation/src/live-run.cli';
import * as factory from '../evaluation/ai-validation/src/live-validator.factory';

const bytes = fs.readFileSync(
  'evaluation/ai-validation/datasets/cobol-java-semantic-v1/manifest.json',
);
const dataset = validateDataset(JSON.parse(bytes.toString('utf8')));
const model = PHASE6_3F.model;
function response(status = 200, body: unknown = generated()): Response {
  return { ok: status === 200, status, headers: new Headers(), json: async () => body } as Response;
}
function generated(version: unknown = model, text = '{"findings":[]}') {
  return { modelVersion: version, candidates: [{ content: { parts: [{ text }] } }] };
}

describe('Phase 6.3F offline resilience; mocked HTTP and isolated temporary campaigns', () => {
  let root: string;
  let options: MultidayOptions;
  let fetchMock: jest.SpiedFunction<typeof fetch>;
  const resume = (extra: Partial<MultidayOptions> = {}) =>
    runMultidayBenchmark({ ...options, resume: true, ...extra });
  const read = (): Checkpoint => JSON.parse(fs.readFileSync(options.checkpoint, 'utf8'));
  beforeEach(() => {
    root = fs.mkdtempSync(join(tmpdir(), 'alsm-resilience-'));
    const output = join(root, 'evaluation/ai-validation/results/multiday', PHASE6_3F.runId);
    const config = new ConfigService({
      ...PHASE6_3F.settings,
      GEMINI_MODEL: model,
      GEMINI_API_KEY: 'offline-only',
      AI_PROMPT_VERSION: PHASE6_3F.promptVersion,
    });
    // Test-only transport has no pacing; persisted identity retains frozen 13000 ms.
    // Production CLI supplies the same frozen config to identity and adapter.
    const transport = new ConfigService({
      ...PHASE6_3F.settings,
      GEMINI_MIN_REQUEST_INTERVAL_MS: 0,
      GEMINI_MODEL: model,
      GEMINI_API_KEY: 'offline-only',
      AI_PROMPT_VERSION: PHASE6_3F.promptVersion,
    });
    const adapter = new GeminiAiValidatorAdapter(transport);
    jest
      .spyOn(adapter as unknown as { delay(ms: number): Promise<void> }, 'delay')
      .mockResolvedValue();
    fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(response());
    options = {
      dataset,
      datasetBytes: bytes,
      config,
      validator: adapter,
      prepareContext: new PrepareAiValidationContextService(
        new ValidationSecretRedactorService(),
        config,
      ),
      failFast: false,
      checkpoint: join(output, 'checkpoint.json'),
      output,
      resume: false,
      confirmNewQuotaWindow: false,
      maxNewCases: 1,
      projectRoot: root,
      provenancePolicy: { version: 1, expectedModelVersion: model },
      providerFailurePolicy: PROVIDER_FAILURE_POLICY,
    };
  });
  afterEach(() => {
    jest.restoreAllMocks();
    // Only the mkdtemp-owned fixture is removed; never repository output.
    fs.rmSync(root, { recursive: true, force: true });
  });
  function exhausted503() {
    for (let i = 0; i < 3; i++)
      fetchMock.mockResolvedValueOnce(response(503, { error: 'private', modelVersion: model }));
  }

  it('caps terminal cases, persists original exhausted 503 and resumes at case 3 without replay', async () => {
    fetchMock.mockResolvedValueOnce(response());
    exhausted503();
    const first = await runMultidayBenchmark({ ...options, maxNewCases: 2 });
    expect(first.checkpointSchemaVersion).toBe(3);
    expect(first.nextIndex).toBe(2);
    expect(first.sessions[0].stopReason).toBe('MAX_NEW_CASES');
    expect(first.results[1]).toMatchObject({
      caseId: 'clean-02',
      status: 'PROVIDER_FAILED',
      modelProvenance: { status: 'UNKNOWN' },
      failure: {
        code: 'AI_PROVIDER_UNAVAILABLE',
        diagnostics: {
          finalFailureClass: 'SERVER_ERROR',
          httpStatus: 503,
          attempts: 3,
          retriesExhausted: true,
        },
      },
    });
    expect(first.results[1].modelProvenance?.observedModelVersion).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const second = await resume();
    expect(second.nextIndex).toBe(3);
    expect(second.results.slice(0, 2)).toEqual(first.results);
    expect(second.sessions[0]).toEqual(first.sessions[0]);
    expect(second.results[2]).toMatchObject({ caseId: 'clean-03', status: 'SUCCESS' });
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(second.quotaEvents).toEqual([]);
    expect(JSON.stringify(second)).not.toContain('private');
    expect(formatCheckpointSummary(second)).toContain('PROVIDER_FAILED UNKNOWN: continuable');
    expect(formatCheckpointSummary(second)).not.toContain('PROVENANCE_REVIEW');
  });

  it('continues in the same session after terminal 503', async () => {
    exhausted503();
    const cp = await runMultidayBenchmark({ ...options, maxNewCases: 2 });
    expect(cp.results.map((r) => r.status)).toEqual(['PROVIDER_FAILED', 'SUCCESS']);
    expect(cp.sessions).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it.each(['NETWORK_ERROR', 'TIMEOUT'] as const)(
    'continues exhausted %s without fabricated observation',
    async (kind) => {
      for (let i = 0; i < 3; i++)
        fetchMock.mockRejectedValueOnce(
          kind === 'NETWORK_ERROR'
            ? new TypeError('private')
            : new AiValidatorError('AI_PROVIDER_TIMEOUT', 'private'),
        );
      const cp = await runMultidayBenchmark({ ...options, maxNewCases: 2 });
      expect(cp.results[0]).toMatchObject({
        status: 'PROVIDER_FAILED',
        modelProvenance: { status: 'UNKNOWN' },
        failure: { diagnostics: { finalFailureClass: kind, attempts: 3 } },
      });
      expect(cp.results[1].status).toBe('SUCCESS');
    },
  );

  it('daily quota pauses before terminal append and preserves events on confirmed resume', async () => {
    fetchMock.mockResolvedValueOnce(
      response(429, {
        error: {
          status: 'RESOURCE_EXHAUSTED',
          details: [
            {
              '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
              violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }],
            },
          ],
        },
      }),
    );
    const cp = await runMultidayBenchmark(options);
    expect(cp.state).toBe('PAUSED_DAILY_QUOTA');
    expect(cp.nextIndex).toBe(0);
    expect(cp.results).toEqual([]);
    expect(cp.quotaEvents).toHaveLength(1);
    await expect(resume()).rejects.toThrow('confirm-new-quota-window');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const next = await resume({ confirmNewQuotaWindow: true });
    expect(next.quotaEvents).toEqual(cp.quotaEvents);
    expect(next.nextIndex).toBe(1);
    expect(next.sessions[1].confirmedNewQuotaWindow).toBe(true);
  });

  it.each([
    ['success unknown', 200, generated(null)],
    ['success mismatch', 200, generated('gemini-other')],
    ['failed mismatch', 200, generated('gemini-other', 'malformed')],
    ['invalid output unknown', 200, generated(null, 'malformed')],
    ['invalid output confirmed', 200, generated(model, 'malformed')],
    ['refused confirmed', 200, { modelVersion: model, promptFeedback: { blockReason: 'SAFETY' } }],
    ['malformed envelope', 200, null],
    ['auth 401', 401, {}],
    ['auth 403', 403, {}],
    ['request rejected', 400, {}],
    ['refused unknown', 200, { promptFeedback: { blockReason: 'SAFETY' } }],
    ['unknown 429', 429, {}],
    [
      'short window 429',
      429,
      {
        error: {
          status: 'RESOURCE_EXHAUSTED',
          details: [
            {
              '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
              violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }],
            },
          ],
        },
      },
    ],
  ])('stops %s and refuses resume without rewriting evidence', async (_label, status, body) => {
    fetchMock.mockResolvedValue(response(status as number, body));
    const cp = await runMultidayBenchmark({ ...options, maxNewCases: 40 });
    expect(cp.nextIndex).toBe(1);
    expect(cp.sessions[0].stopReason).toBe('PROVENANCE_REVIEW');
    const saved = fs.readFileSync(options.checkpoint);
    const calls = fetchMock.mock.calls.length;
    await expect(resume()).rejects.toThrow('PROVENANCE_REVIEW');
    expect(fs.readFileSync(options.checkpoint)).toEqual(saved);
    expect(fetchMock).toHaveBeenCalledTimes(calls);
    expect(formatCheckpointSummary(cp)).toContain('PROVENANCE_REVIEW');
    expect(fs.existsSync(join(options.output, 'predictions.json'))).toBe(false);
  });

  it.each([
    undefined,
    {
      finalFailureClass: 'SERVER_ERROR',
      httpStatus: 503,
      attempts: -1,
      retriesExhausted: true,
      totalLatencyMs: 0,
    },
  ])('stops missing or unsafe diagnostics %j', async (diagnostics) => {
    jest
      .spyOn(options.validator, 'validate')
      .mockRejectedValue(
        new AiValidatorError('AI_PROVIDER_UNAVAILABLE', 'private', diagnostics as never),
      );
    const cp = await runMultidayBenchmark({ ...options, maxNewCases: 2 });
    expect(cp.nextIndex).toBe(1);
    expect(cp.results[0].failure?.diagnostics).toBeUndefined();
    await expect(resume()).rejects.toThrow('PROVENANCE_REVIEW');
  });

  it.each([0, 39])(
    'materializes 40 terminal results with 503 at index %i as an unverified cohort',
    async (failureIndex) => {
      for (let i = 0; i < failureIndex; i++) fetchMock.mockResolvedValueOnce(response());
      exhausted503();
      const cp = await runMultidayBenchmark({ ...options, maxNewCases: 40 });
      expect(cp.state).toBe('COMPLETE');
      const predictions = validatePredictions(
        JSON.parse(fs.readFileSync(join(options.output, 'predictions.json'), 'utf8')),
        dataset,
      );
      expect(predictions.providerFailurePolicy).toEqual(PROVIDER_FAILURE_POLICY);
      expect(predictions.cases[failureIndex].status).toBe('PROVIDER_FAILED');
      const score = scoreEvaluation(dataset, predictions);
      expect(score.provenance).toMatchObject({
        verifiedSingleModelCohort: false,
        confirmed: 39,
        unknown: 1,
        mismatch: 0,
      });
      expect(score.execution).toMatchObject({
        totalCases: 40,
        terminalCases: 40,
        successfulCases: 39,
        failedCases: 1,
      });
      const legacy = structuredClone(predictions);
      delete legacy.providerFailurePolicy;
      delete legacy.provenancePolicy;
      legacy.cases.forEach((r) => delete r.modelProvenance);
      const oldScore = scoreEvaluation(dataset, legacy);
      expect(score.successfulCases).toEqual(oldScore.successfulCases);
      expect(score.conservative).toEqual(oldScore.conservative);
      const report = renderEvaluationReport(score);
      expect(report).toContain('NO — UNVERIFIED');
      expect(report).toContain('Terminal execution coverage: 40/40');
      expect(report).toContain('| SERVER_ERROR | 503 | 3 |');
      expect(formatCheckpointSummary(cp)).toContain('NO — UNVERIFIED');
      const finalBytes = fs.readFileSync(join(options.output, 'predictions.json'));
      await resume();
      expect(fetchMock).toHaveBeenCalledTimes(42);
      expect(fs.readFileSync(join(options.output, 'predictions.json'))).toEqual(finalBytes);
    },
  );

  it('all 40 confirmed successes remain a verified cohort', async () => {
    const cp = await runMultidayBenchmark({ ...options, maxNewCases: 40 });
    expect(
      scoreEvaluation(dataset, materializePredictions(cp, dataset, cp.identity)).provenance
        .verifiedSingleModelCohort,
    ).toBe(true);
  });

  it.each([null, 'gemini-other'])(
    'blocks case 40 with version %j before final materialization',
    async (version) => {
      await runMultidayBenchmark({ ...options, maxNewCases: 39 });
      fetchMock.mockResolvedValue(response(200, generated(version)));
      const cp = await resume();
      expect(cp.state).toBe('READY');
      expect(cp.nextIndex).toBe(40);
      expect(cp.sessions.at(-1)?.stopReason).toBe('PROVENANCE_REVIEW');
      expect(validateCheckpoint(cp, dataset, cp.identity)).toEqual(cp);
      expect(() => materializePredictions(cp, dataset, cp.identity)).toThrow();
      await expect(resume()).rejects.toThrow('PROVENANCE_REVIEW');
      expect(fetchMock).toHaveBeenCalledTimes(40);
      expect(fs.existsSync(join(options.output, 'predictions.json'))).toBe(false);
    },
  );

  it('refuses missing policy before directory creation or provider access', async () => {
    await expect(
      runMultidayBenchmark({ ...options, providerFailurePolicy: undefined }),
    ).rejects.toThrow('Phase 6.3F requires');
    expect(fs.existsSync(options.output)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects policy removal, modification, copied runs and immutable terminal tampering', async () => {
    exhausted503();
    const cp = await runMultidayBenchmark(options);
    await expect(resume({ providerFailurePolicy: undefined })).rejects.toThrow();
    const removed = structuredClone(cp);
    delete removed.identity.providerFailurePolicy;
    expect(() => validateCheckpoint(removed, dataset, cp.identity)).toThrow();
    const modified = structuredClone(cp);
    Object.assign(modified.identity.providerFailurePolicy!, { mode: 'anything' });
    expect(() => validateCheckpoint(modified, dataset, cp.identity)).toThrow();
    const tampered = structuredClone(cp);
    tampered.results[0].latencyMs = 999;
    expect(() => assertTransition(cp, tampered)).toThrow('immutable terminal');
    const output = join(root, 'evaluation/ai-validation/results/multiday/other-run');
    await expect(resume({ output, checkpoint: join(output, 'checkpoint.json') })).rejects.toThrow(
      'Phase 6.3F requires',
    );
    expect(fs.existsSync(output)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([1, 2])('round-trips legacy v%i unchanged and rejects policy retrofit', (version) => {
    const identity = createRunIdentity(
      dataset,
      bytes,
      options.validator.getMetadata(),
      options.config,
      'a'.repeat(64),
      false,
      version === 2 ? options.provenancePolicy : undefined,
    );
    const cp = initialCheckpoint(identity, '2026-10-12T00:00:00.000Z');
    const serialized = JSON.stringify(cp);
    expect(JSON.stringify(validateCheckpoint(JSON.parse(serialized), dataset, identity))).toBe(
      serialized,
    );
    expect(cp.checkpointSchemaVersion).toBe(version);
    const newer = { ...identity, providerFailurePolicy: PROVIDER_FAILURE_POLICY };
    expect(() => validateCheckpoint(cp, dataset, newer)).toThrow('provider failure policy');
    cp.identity = newer;
    expect(() => validateCheckpoint(cp, dataset, newer)).toThrow('schema/policy');
  });

  it.each(['phase6-3d-gemini-v1', 'phase6-3e-gemini36-v1'])(
    'protects %s before writes, including direct store acquisition',
    (runId) => {
      const output = join(root, 'evaluation/ai-validation/results/multiday', runId);
      fs.mkdirSync(output, { recursive: true });
      const path = join(output, 'checkpoint.json');
      fs.writeFileSync(path, 'protected fixture');
      const identity = createRunIdentity(
        dataset,
        bytes,
        options.validator.getMetadata(),
        options.config,
        checkpointLocation(path, output, root).storageFingerprint,
        false,
        options.provenancePolicy,
      );
      expect(() => CheckpointStore.acquire(path, output, dataset, identity, root)).toThrow(
        'Protected Phase',
      );
      expect(fs.readFileSync(path, 'utf8')).toBe('protected fixture');
      expect(fs.readdirSync(output)).toEqual(['checkpoint.json']);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('recovers interrupted between-case sessions across a terminal 503 without replay', async () => {
    exhausted503();
    const realSave = CheckpointStore.prototype.save;
    const spy = jest.spyOn(CheckpointStore.prototype, 'save').mockImplementation(function (
      this: CheckpointStore,
      cp: Checkpoint,
    ) {
      if (cp.state === 'IN_PROGRESS' && cp.nextIndex === 1) throw new Error('interruption');
      realSave.call(this, cp);
    });
    await expect(runMultidayBenchmark({ ...options, maxNewCases: 3 })).rejects.toThrow(
      'interruption',
    );
    expect(read().nextIndex).toBe(1);
    spy.mockRestore();
    const cp = await resume();
    expect(cp.sessions[0].stopReason).toBe('INTERRUPTED_BETWEEN_CASES');
    expect(cp.results[0].status).toBe('PROVIDER_FAILED');
    expect(cp.nextIndex).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('refuses stale locks and IN_PROGRESS without deleting locks or retrying a case', async () => {
    const cp = await runMultidayBenchmark(options);
    const lock = join(options.output, '.session.lock');
    fs.writeFileSync(lock, 'fixture lock');
    await expect(resume()).rejects.toThrow('session lock');
    expect(fs.readFileSync(lock, 'utf8')).toBe('fixture lock');
    // Remove only this test-created lock to independently test in-flight recovery.
    fs.unlinkSync(lock);
    cp.state = 'IN_PROGRESS';
    cp.sessions.push({
      sequence: 2,
      startedAt: cp.updatedAt,
      startIndex: 1,
      confirmedNewQuotaWindow: false,
    });
    fs.writeFileSync(options.checkpoint, JSON.stringify(cp));
    await expect(resume()).rejects.toThrow('AMBIGUOUS_INTERRUPTION');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('accepts only exact CRLF/LF frozen bytes and rejects all frozen-setting drift', () => {
    const lf = bytes.toString('utf8').replace(/\r\n/g, '\n');
    for (const content of [lf, lf.replace(/\n/g, '\r\n')]) {
      const identity = createRunIdentity(
        dataset,
        Buffer.from(content),
        options.validator.getMetadata(),
        options.config,
        'a'.repeat(64),
        false,
        options.provenancePolicy,
        PROVIDER_FAILURE_POLICY,
      );
      expect(() => assertPhase63fIdentity(PHASE6_3F.runId, identity)).not.toThrow();
      for (const key of Object.keys(PHASE6_3F.settings) as (keyof typeof PHASE6_3F.settings)[]) {
        const changed = structuredClone(identity);
        changed.settings[key]++;
        expect(() => assertPhase63fIdentity(PHASE6_3F.runId, changed)).toThrow();
      }
      for (const changed of [
        { ...identity, model: 'gemini-other' },
        { ...identity, failFast: true },
        { ...identity, promptVersion: 'different' },
        { ...identity, datasetSha256: '0'.repeat(64) },
        {
          ...identity,
          provenancePolicy: { version: 1 as const, expectedModelVersion: 'gemini-other' },
        },
      ])
        expect(() => assertPhase63fIdentity(PHASE6_3F.runId, changed)).toThrow();
    }
    const changed = createRunIdentity(
      dataset,
      Buffer.from(lf + ' '),
      options.validator.getMetadata(),
      options.config,
      'a'.repeat(64),
      false,
      options.provenancePolicy,
      PROVIDER_FAILURE_POLICY,
    );
    expect(() => assertPhase63fIdentity(PHASE6_3F.runId, changed)).toThrow();
  });

  it('never grants continuation for contradictory diagnostics, codes or observations', async () => {
    exhausted503();
    const cp = await runMultidayBenchmark(options);
    for (const change of [
      { httpStatus: 403 },
      { retriesExhausted: false },
      { attempts: 2 },
      { rateLimitScope: 'DAILY_QUOTA' },
    ]) {
      const result = structuredClone(cp.results[0]);
      Object.assign(result.failure!.diagnostics!, change);
      expect(isContinuableProviderFailure(cp.identity, result)).toBe(false);
    }
    const result = structuredClone(cp.results[0]);
    result.failure!.code = 'AI_PROVIDER_REFUSED';
    expect(isContinuableProviderFailure(cp.identity, result)).toBe(false);
    result.failure!.code = 'AI_PROVIDER_UNAVAILABLE';
    result.modelProvenance!.observedModelVersion = model;
    expect(isContinuableProviderFailure(cp.identity, result)).toBe(false);
  });

  it('requires explicit CLI policy opt-in with checkpoint and expected model', () => {
    expect(() => parseLiveArguments(['--continue-on-transient-provider-failure'])).toThrow();
    expect(() =>
      parseLiveArguments([
        '--checkpoint',
        'x',
        '--all',
        '--continue-on-transient-provider-failure',
      ]),
    ).toThrow();
    expect(
      parseLiveArguments([
        '--checkpoint',
        'x',
        '--all',
        '--expected-model-version',
        model,
        '--continue-on-transient-provider-failure',
      ]).continueOnTransientProviderFailure,
    ).toBe(true);
  });

  it('CLI reports COMPLETE with provider failures as UNVERIFIED without a false review blocker', async () => {
    const datasetPath = join(
      process.cwd(),
      'evaluation/ai-validation/datasets/cobol-java-semantic-v1/manifest.json',
    );
    jest.spyOn(process, 'cwd').mockReturnValue(root);
    jest
      .spyOn(factory, 'createLiveValidator')
      .mockReturnValue({ config: options.config, validator: options.validator });
    const stdout = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
    exhausted503();
    await main(
      [
        '--dataset',
        datasetPath,
        '--output',
        options.output,
        '--checkpoint',
        options.checkpoint,
        '--all',
        '--expected-model-version',
        model,
        '--continue-on-transient-provider-failure',
        '--allow-live-provider',
      ],
      { AI_EVAL_ALLOW_LIVE_PROVIDER: 'true' },
    );
    const output = stdout.mock.calls.map((call) => String(call[0])).join('');
    expect(output).toContain('COMPLETE; 40/40 terminal cases');
    expect(output).toContain('39 SUCCESS; 1 PROVIDER_FAILED');
    expect(output).toContain('NO — UNVERIFIED');
    expect(output).toContain('PROVIDER_FAILED UNKNOWN: continuable');
    expect(output).not.toContain('PROVENANCE_REVIEW');
    expect(output).not.toContain('private');
    expect(fetchMock).toHaveBeenCalledTimes(42);
  });
});
