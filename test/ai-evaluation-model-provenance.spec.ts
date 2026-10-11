import * as fs from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import { GeminiAiValidatorAdapter } from '../src/modules/validation/infrastructure/gemini-ai-validator.adapter';
import {
  AI_RESPONSE_METADATA,
  WithAiResponseMetadata,
} from '../src/modules/validation/domain/ai-response-metadata';
import { PrepareAiValidationContextService } from '../src/modules/validation/application/prepare-ai-validation-context.service';
import { ValidationSecretRedactorService } from '../src/modules/validation/application/validation-secret-redactor.service';
import {
  MultidayOptions,
  runMultidayBenchmark,
} from '../evaluation/ai-validation/src/multiday-runner';
import {
  createRunIdentity,
  initialCheckpoint,
  materializePredictions,
  predictionEnvelope,
  validateCheckpoint,
} from '../evaluation/ai-validation/src/multiday-checkpoint';
import {
  checkpointLocation,
  assertLegacyOutputOutsideMultiday,
} from '../evaluation/ai-validation/src/multiday-store';
import {
  PHASE6_3E,
  assertPhase63eIdentity,
} from '../evaluation/ai-validation/src/phase6-3e-campaign';
import {
  validateDataset,
  validatePredictions,
} from '../evaluation/ai-validation/src/evaluation.validator';
import { scoreEvaluation } from '../evaluation/ai-validation/src/evaluation.scorer';
import { renderEvaluationReport } from '../evaluation/ai-validation/src/evaluation.report';
import { main, parseLiveArguments } from '../evaluation/ai-validation/src/live-run.cli';

const bytes = fs.readFileSync(
  'evaluation/ai-validation/datasets/cobol-java-semantic-v1/manifest.json',
);
const dataset = validateDataset(JSON.parse(bytes.toString('utf8')));
const model = PHASE6_3E.model;
const input = {
  conversionJobId: 'offline-test',
  sourceFiles: [{ path: 'a.cob', content: '1 | STOP RUN.', lineCount: 1 }],
  targetFiles: [{ path: 'A.java', content: '1 | return;', lineCount: 1 }],
};
function generated(modelVersion: unknown = model, text = '{"findings":[]}') {
  return { modelVersion, candidates: [{ content: { parts: [{ text }] } }] };
}
function response(body: unknown, status = 200): Response {
  return { ok: status === 200, status, headers: new Headers(), json: async () => body } as Response;
}

describe('Phase 6.3E provenance (offline HTTP mocks; temporary stores only)', () => {
  let root: string;
  let adapter: GeminiAiValidatorAdapter;
  let options: MultidayOptions;
  let fetchMock: jest.SpiedFunction<typeof fetch>;
  beforeEach(() => {
    root = fs.mkdtempSync(join(tmpdir(), 'alsm-provenance-'));
    const output = join(root, 'evaluation/ai-validation/results/multiday/offline-provenance');
    const config = new ConfigService({
      ...PHASE6_3E.settings,
      GEMINI_MIN_REQUEST_INTERVAL_MS: 0,
      GEMINI_MODEL: model,
      GEMINI_API_KEY: 'synthetic-test-key',
      AI_PROMPT_VERSION: PHASE6_3E.promptVersion,
    });
    adapter = new GeminiAiValidatorAdapter(config);
    jest
      .spyOn(adapter as unknown as { delay(ms: number): Promise<void> }, 'delay')
      .mockResolvedValue();
    fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(response(generated()));
    options = {
      dataset,
      datasetBytes: bytes,
      validator: adapter,
      config,
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
    };
  });
  afterEach(() => {
    jest.restoreAllMocks();
    // root is created by mkdtemp above, never the repository evidence tree.
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('captures only allowlisted response metadata without changing JSON or findings', async () => {
    fetchMock.mockResolvedValue(
      response({ ...generated(), headers: { secret: 'private' }, responseId: 'private' }),
    );
    const result = await adapter.validate(input);
    expect(result).toEqual({ findings: [] });
    expect(JSON.stringify(result)).toBe('{"findings":[]}');
    expect(result[AI_RESPONSE_METADATA]).toEqual({ requestedModel: model, modelVersion: model });
    expect(Object.isFrozen(result[AI_RESPONSE_METADATA])).toBe(true);
  });

  it.each([null, 42, {}, '', ' gemini-3.6-flash ', 'secret\nsource', 'gemini-' + 'x'.repeat(129)])(
    'discards unsafe modelVersion %j and stops without inventing a version',
    async (version) => {
      fetchMock.mockResolvedValue(response(generated(version)));
      const cp = await runMultidayBenchmark(options);
      expect(cp.results[0].modelProvenance).toEqual({
        version: 1,
        requestedModel: model,
        status: 'UNKNOWN',
      });
      expect(cp.state).toBe('READY');
      expect(cp.sessions[0].stopReason).toBe('PROVENANCE_REVIEW');
      expect(fs.existsSync(join(options.output, 'predictions.json'))).toBe(false);
    },
  );

  it('handles a genuinely absent version and never reuses metadata from a preceding response', async () => {
    const first = await runMultidayBenchmark(options);
    const body = generated();
    delete (body as { modelVersion?: unknown }).modelVersion;
    fetchMock.mockResolvedValue(response(body));
    const cp = await runMultidayBenchmark({ ...options, resume: true, maxNewCases: 3 });
    expect(cp.results[0]).toEqual(first.results[0]);
    expect(cp.results[1].modelProvenance?.status).toBe('UNKNOWN');
    expect(cp.results[1].modelProvenance?.observedModelVersion).toBeUndefined();
    expect(cp.nextIndex).toBe(2);
    const before = fs.readFileSync(options.checkpoint);
    await expect(runMultidayBenchmark({ ...options, resume: true })).rejects.toThrow(
      'PROVENANCE_REVIEW',
    );
    expect(fs.readFileSync(options.checkpoint)).toEqual(before);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    'gemini-3.5-flash',
    'gemini-3.6-flash-001',
    'gemini-3.6-flash-lite',
    'gemini-3.6-flash-preview-10-2026',
  ])(
    'retains unexpected version %s but does not infer identity from its prefix',
    async (observed) => {
      fetchMock.mockResolvedValue(response(generated(observed)));
      const cp = await runMultidayBenchmark({ ...options, maxNewCases: 40 });
      expect(cp.nextIndex).toBe(1);
      expect(cp.results[0].modelProvenance).toMatchObject({
        observedModelVersion: observed,
        status: 'MISMATCH',
      });
      expect(cp.sessions[0].stopReason).toBe('PROVENANCE_REVIEW');
    },
  );

  it('can pin an explicit version distinct from the request name in a separately identified run', async () => {
    fetchMock.mockResolvedValue(response(generated('gemini-3.6-flash-001')));
    const cp = await runMultidayBenchmark({
      ...options,
      provenancePolicy: { version: 1, expectedModelVersion: 'gemini-3.6-flash-001' },
    });
    expect(cp.results[0].modelProvenance).toEqual({
      version: 1,
      requestedModel: model,
      observedModelVersion: 'gemini-3.6-flash-001',
      status: 'CONFIRMED',
    });
  });

  it.each([null, [], 'invalid', { candidates: [] }, generated(model, '{bad-json')])(
    'malformed response %j never becomes successful findings',
    async (body) => {
      fetchMock.mockResolvedValue(response(body));
      const cp = await runMultidayBenchmark(options);
      expect(cp.results[0].status).toBe('INVALID_OUTPUT');
      expect(cp.results[0].findings).toBeUndefined();
      expect(cp.results[0].failure?.code).toBe('AI_PROVIDER_RESPONSE_INVALID');
    },
  );

  it('retains the reported version on a failed output without exposing raw response content', async () => {
    fetchMock.mockResolvedValue(response(generated(model, 'private-malformed-output')));
    const cp = await runMultidayBenchmark(options);
    expect(cp.results[0].modelProvenance?.status).toBe('CONFIRMED');
    expect(cp.results[0].status).toBe('INVALID_OUTPUT');
    expect(JSON.stringify(cp)).not.toContain('private-malformed-output');
  });

  it('records provider failure as UNKNOWN without trusting an error body version', async () => {
    fetchMock.mockResolvedValue(response({ modelVersion: model, error: 'private' }, 503));
    const cp = await runMultidayBenchmark(options);
    expect(cp.results[0].status).toBe('PROVIDER_FAILED');
    expect(cp.results[0].modelProvenance?.status).toBe('UNKNOWN');
    expect(cp.results[0].failure?.diagnostics?.attempts).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('uses only the final successful response version after the unchanged retry policy', async () => {
    fetchMock.mockResolvedValueOnce(response({ modelVersion: 'gemini-wrong' }, 503));
    const cp = await runMultidayBenchmark(options);
    expect(cp.results[0].modelProvenance?.observedModelVersion).toBe(model);
    expect(cp.results[0].status).toBe('SUCCESS');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retains request configuration drift as a durable mismatch rather than confirming the envelope model', async () => {
    const metadata = adapter.getMetadata();
    jest
      .spyOn(adapter, 'getMetadata')
      .mockReturnValueOnce(metadata)
      .mockReturnValueOnce(metadata)
      .mockReturnValue({ ...metadata, model: 'gemini-other' });
    const cp = await runMultidayBenchmark(options);
    expect(cp.results[0].modelProvenance).toMatchObject({
      requestedModel: 'gemini-other',
      observedModelVersion: model,
      status: 'MISMATCH',
    });
    expect(cp.sessions[0].stopReason).toBe('PROVENANCE_REVIEW');
  });

  it('preserves quota pause semantics and records no invented terminal result', async () => {
    fetchMock.mockResolvedValue(
      response(
        {
          error: {
            status: 'RESOURCE_EXHAUSTED',
            details: [
              {
                '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
                violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }],
              },
            ],
          },
        },
        429,
      ),
    );
    const cp = await runMultidayBenchmark(options);
    expect(cp.state).toBe('PAUSED_DAILY_QUOTA');
    expect(cp.results).toEqual([]);
    expect(cp.nextIndex).toBe(0);
    expect(cp.quotaEvents).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('round-trips v2, resumes without rerunning results and refuses policy changes or removal', async () => {
    const first = await runMultidayBenchmark(options);
    expect(first.checkpointSchemaVersion).toBe(2);
    const second = await runMultidayBenchmark({ ...options, resume: true });
    expect(second.results[0]).toEqual(first.results[0]);
    expect(second.nextIndex).toBe(2);
    expect(
      validateCheckpoint(JSON.parse(JSON.stringify(second)), dataset, second.identity),
    ).toEqual(second);
    for (const provenancePolicy of [
      undefined,
      { version: 1 as const, expectedModelVersion: 'gemini-other' },
    ])
      await expect(
        runMultidayBenchmark({ ...options, resume: true, provenancePolicy }),
      ).rejects.toThrow('provenance policy');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not automatically recover an ambiguous in-flight checkpoint', async () => {
    const cp = await runMultidayBenchmark(options);
    cp.state = 'IN_PROGRESS';
    cp.sessions.push({
      sequence: 2,
      startIndex: 1,
      startedAt: cp.updatedAt,
      confirmedNewQuotaWindow: false,
    });
    fs.writeFileSync(options.checkpoint, JSON.stringify(cp));
    await expect(runMultidayBenchmark({ ...options, resume: true })).rejects.toThrow(
      'AMBIGUOUS_INTERRUPTION',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('parses and resumes legacy v1 without adding provenance to historic results', async () => {
    const legacy = { ...options, provenancePolicy: undefined };
    const first = await runMultidayBenchmark(legacy);
    expect(first.checkpointSchemaVersion).toBe(1);
    const raw = JSON.stringify(first);
    expect(validateCheckpoint(JSON.parse(raw), dataset, first.identity)).toEqual(first);
    expect(JSON.stringify(first)).toBe(raw);
    const next = await runMultidayBenchmark({ ...legacy, resume: true });
    expect(next.results[0]).toEqual(first.results[0]);
    expect(next.results.every((r) => !r.modelProvenance)).toBe(true);
  });

  it('materializes a confirmed 40-case cohort and reports per-case evidence with unchanged metrics', async () => {
    const cp = await runMultidayBenchmark({ ...options, maxNewCases: 40 });
    const predictions = materializePredictions(cp, dataset, cp.identity);
    const score = scoreEvaluation(dataset, predictions);
    expect(score.provenance).toMatchObject({
      verifiedSingleModelCohort: true,
      confirmed: 40,
      unknown: 0,
      mismatch: 0,
    });
    const legacy = structuredClone(predictions);
    delete legacy.provenancePolicy;
    legacy.cases.forEach((c) => delete c.modelProvenance);
    const legacyScore = scoreEvaluation(dataset, legacy);
    expect(legacyScore.provenance.verifiedSingleModelCohort).toBe(false);
    expect(score.successfulCases).toEqual(legacyScore.successfulCases);
    expect(score.conservative).toEqual(legacyScore.conservative);
    expect(score.cases).toEqual(legacyScore.cases);
    expect(renderEvaluationReport(score)).toContain('Verified single-model cohort: YES');
    expect(renderEvaluationReport(legacyScore)).toContain('NO — UNVERIFIED');
    expect(renderEvaluationReport(score)).toContain(
      `| clean-01 | ${model} | ${model} | CONFIRMED |`,
    );
  });

  it('never publishes a verified cohort for partial, missing or mismatched evidence', async () => {
    fetchMock.mockResolvedValue(response(generated(null)));
    const cp = await runMultidayBenchmark(options);
    const predictions = predictionEnvelope(cp);
    const score = scoreEvaluation(dataset, predictions);
    expect(score.provenance).toMatchObject({ verifiedSingleModelCohort: false, unknown: 40 });
    expect(renderEvaluationReport(score)).toContain('NO — UNVERIFIED');
    expect(() => materializePredictions(cp, dataset, cp.identity)).toThrow('Partial');
    predictions.cases[0].modelProvenance!.status = 'CONFIRMED';
    expect(() => validatePredictions(predictions, dataset)).toThrow('provenance');
    expect(() => scoreEvaluation(dataset, predictions)).toThrow('provenance');
  });

  it('saves the fortieth unverified result durably but refuses final materialization and resume', async () => {
    await runMultidayBenchmark({ ...options, maxNewCases: 39 });
    fetchMock.mockResolvedValue(response(generated(null)));
    await expect(runMultidayBenchmark({ ...options, resume: true })).rejects.toThrow(
      'Unverified model provenance',
    );
    const cp = JSON.parse(fs.readFileSync(options.checkpoint, 'utf8'));
    expect(cp.nextIndex).toBe(40);
    expect(cp.results[39].modelProvenance.status).toBe('UNKNOWN');
    expect(validateCheckpoint(cp, dataset, cp.identity)).toEqual(cp);
    expect(fs.existsSync(join(options.output, 'predictions.json'))).toBe(false);
    await expect(runMultidayBenchmark({ ...options, resume: true })).rejects.toThrow(
      'PROVENANCE_REVIEW',
    );
    expect(fetchMock).toHaveBeenCalledTimes(40);
  });

  it('rejects protected campaign paths before touching disk, even when resume is requested', async () => {
    const output = join(root, 'evaluation/ai-validation/results/multiday/phase6-3d-gemini-v1');
    fs.mkdirSync(output, { recursive: true });
    const checkpoint = join(output, 'checkpoint.json');
    fs.writeFileSync(checkpoint, 'synthetic protected checkpoint');
    fs.writeFileSync(join(output, 'predictions.json'), 'synthetic protected output');
    for (const resume of [false, true])
      await expect(
        runMultidayBenchmark({ ...options, output, checkpoint, resume }),
      ).rejects.toThrow('Protected Phase 6.3D');
    expect(fs.readFileSync(checkpoint, 'utf8')).toBe('synthetic protected checkpoint');
    expect(fs.readFileSync(join(output, 'predictions.json'), 'utf8')).toBe(
      'synthetic protected output',
    );
    expect(fs.readdirSync(output).sort()).toEqual(['checkpoint.json', 'predictions.json']);
    expect(() => assertLegacyOutputOutsideMultiday(output, root)).toThrow('cannot overwrite');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires canonical campaign settings before creating even an empty directory', async () => {
    const output = join(root, `evaluation/ai-validation/results/multiday/${PHASE6_3E.runId}`);
    await expect(
      runMultidayBenchmark({ ...options, output, checkpoint: join(output, 'checkpoint.json') }),
    ).rejects.toThrow('Phase 6.3E requires');
    expect(fs.existsSync(output)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    const identity = createRunIdentity(
      dataset,
      bytes,
      adapter.getMetadata(),
      new ConfigService(PHASE6_3E.settings),
      checkpointLocation(join(output, 'checkpoint.json'), output, root).storageFingerprint,
      false,
      options.provenancePolicy,
    );
    expect(initialCheckpoint(identity, new Date().toISOString()).checkpointSchemaVersion).toBe(2);
    expect(() => assertPhase63eIdentity(output, identity)).not.toThrow();
    for (const changed of [
      { ...identity, provenancePolicy: undefined },
      { ...identity, model: 'gemini-3.5-flash' },
      { ...identity, promptVersion: 'different' },
      { ...identity, datasetSha256: '0'.repeat(64) },
      {
        ...identity,
        provenancePolicy: { version: 1 as const, expectedModelVersion: 'gemini-3.6-flash-001' },
      },
    ])
      expect(() => assertPhase63eIdentity(output, changed)).toThrow('Phase 6.3E requires');
  });

  it('requires checkpoint scope and safe syntax for the explicit expected-version CLI option', () => {
    expect(() => parseLiveArguments(['--expected-model-version', model, '--all'])).toThrow(
      'require --checkpoint',
    );
    expect(
      parseLiveArguments(['--checkpoint', 'unused', '--all', '--expected-model-version', model])
        .expectedModelVersion,
    ).toBe(model);
    expect(() =>
      parseLiveArguments([
        '--checkpoint',
        'unused',
        '--all',
        '--expected-model-version',
        'private\nvalue',
      ]),
    ).toThrow('Invalid expected');
  });

  it('CLI rejects unverified identity after durable recording instead of reporting terminal success', async () => {
    const datasetPath = join(
      process.cwd(),
      'evaluation/ai-validation/datasets/cobol-java-semantic-v1/manifest.json',
    );
    jest.spyOn(process, 'cwd').mockReturnValue(root);
    const stdout = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
    fetchMock.mockResolvedValue(response(generated(null)));
    await expect(
      main(
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
          '--max-new-cases',
          '1',
          '--allow-live-provider',
        ],
        {
          AI_EVAL_ALLOW_LIVE_PROVIDER: 'true',
          AI_PROVIDER: 'gemini',
          GEMINI_MODEL: model,
          GEMINI_API_KEY: 'synthetic-test-key',
          GEMINI_MIN_REQUEST_INTERVAL_MS: '0',
        },
      ),
    ).rejects.toThrow('PROVENANCE_REVIEW');
    expect(stdout.mock.calls.map((call) => String(call[0])).join('')).toContain(
      'Model provenance: 0/1 confirmed',
    );
    expect(
      JSON.parse(fs.readFileSync(options.checkpoint, 'utf8')).results[0].modelProvenance.status,
    ).toBe('UNKNOWN');
    expect(fs.existsSync(join(options.output, 'predictions.json'))).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('associates concurrent responses with the correct invocation', async () => {
    let release!: (value: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    fetchMock.mockResolvedValueOnce(response(generated('gemini-other')));
    const first = adapter.validate(input);
    const second = await adapter.validate(input);
    release(response(generated(model)));
    expect((await first)[AI_RESPONSE_METADATA]?.modelVersion).toBe(model);
    expect((second as WithAiResponseMetadata)[AI_RESPONSE_METADATA]?.modelVersion).toBe(
      'gemini-other',
    );
  });
});
