import * as fs from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { AiValidatorError } from '../src/modules/validation/domain/ai-validator.error';
import { AiProviderDiagnostics } from '../src/modules/validation/domain/ai-provider-diagnostics';
import { PrepareAiValidationContextService } from '../src/modules/validation/application/prepare-ai-validation-context.service';
import { ValidationSecretRedactorService } from '../src/modules/validation/application/validation-secret-redactor.service';
import {
  validateDataset,
  validatePredictions,
} from '../evaluation/ai-validation/src/evaluation.validator';
import { scoreEvaluation } from '../evaluation/ai-validation/src/evaluation.scorer';
import { parseLiveArguments } from '../evaluation/ai-validation/src/live-run.cli';
import { assertLiveProviderOptIn } from '../evaluation/ai-validation/src/live-runner';
import {
  Checkpoint,
  createRunIdentity,
  initialCheckpoint,
  materializePredictions,
  sha256,
  validateCheckpoint,
  assertTransition,
} from '../evaluation/ai-validation/src/multiday-checkpoint';
import {
  CheckpointStore,
  checkpointLocation,
  assertLegacyOutputOutsideMultiday,
} from '../evaluation/ai-validation/src/multiday-store';
import {
  MultidayOptions,
  runMultidayBenchmark,
} from '../evaluation/ai-validation/src/multiday-runner';

const bytes = fs.readFileSync(
  'evaluation/ai-validation/datasets/cobol-java-semantic-v1/manifest.json',
);
const frozen = validateDataset(JSON.parse(bytes.toString('utf8')));
const secret = 'synthetic-private-should-never-be-checkpointed';
function providerFailure(
  kind: AiProviderDiagnostics['finalFailureClass'],
  scope?: AiProviderDiagnostics['rateLimitScope'],
) {
  return new AiValidatorError('AI_PROVIDER_UNAVAILABLE', secret, {
    finalFailureClass: kind,
    ...(scope ? { rateLimitScope: scope } : {}),
    attempts: 1,
    retriesExhausted: scope !== 'DAILY_QUOTA',
    totalLatencyMs: 1,
    httpStatus: 429,
  });
}

describe('multiday benchmark integrity (fake providers only)', () => {
  let root: string;
  let options: MultidayOptions;
  let validate: jest.Mock;
  beforeEach(() => {
    root = fs.mkdtempSync(join(tmpdir(), 'alsm-multiday-'));
    const output = join(root, 'evaluation/ai-validation/results/multiday/test-run');
    const config = new ConfigService({
      AI_MAX_RETRIES: 2,
      AI_TIMEOUT_MS: 60000,
      AI_MAX_FINDINGS: 50,
      GEMINI_MIN_REQUEST_INTERVAL_MS: 13000,
      AI_MAX_FILES: 50,
      AI_MAX_FILE_CHARS: 200000,
      AI_MAX_TOTAL_CHARS: 500000,
      GEMINI_API_KEY: secret,
    });
    validate = jest.fn().mockResolvedValue({ findings: [] });
    options = {
      dataset: structuredClone(frozen),
      datasetBytes: bytes,
      config,
      validator: {
        getMetadata: () => ({
          provider: 'gemini',
          model: 'synthetic-model',
          promptVersion: 'semantic-cobol-java-v1',
        }),
        validate,
      },
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
      now: () => new Date('2026-10-06T00:00:00.000Z'),
    };
    jest.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('Real network forbidden');
    });
  });
  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });
  function identity() {
    return createRunIdentity(
      options.dataset,
      options.datasetBytes,
      options.validator.getMetadata(),
      options.config,
      checkpointLocation(options.checkpoint, options.output, root).storageFingerprint,
      options.failFast,
    );
  }
  function read(): Checkpoint {
    return JSON.parse(fs.readFileSync(options.checkpoint, 'utf8'));
  }
  async function resume(extra: Partial<MultidayOptions> = {}) {
    return runMultidayBenchmark({ ...options, resume: true, ...extra });
  }

  it('captures full frozen identity, durable pre-call state, ordered immutable results and safe settings', async () => {
    validate.mockImplementation(async () => {
      const cp = read();
      expect(cp.state).toBe('IN_PROGRESS');
      expect(cp.nextIndex).toBe(0);
      expect(cp.results).toEqual([]);
      return { findings: [] };
    });
    const cp = await runMultidayBenchmark(options);
    expect(cp.identity.caseIds).toEqual(frozen.cases.map((c) => c.caseId));
    expect(cp.identity.datasetSha256).toBe(sha256(bytes));
    expect(cp.identity.settings.GEMINI_MIN_REQUEST_INTERVAL_MS).toBe(13000);
    expect(cp.results.map((r) => r.caseId)).toEqual([frozen.cases[0].caseId]);
    expect(cp.nextIndex).toBe(1);
    expect(cp.state).toBe('READY');
    expect(cp.sessions[0].stopReason).toBe('MAX_NEW_CASES');
    expect(fs.existsSync(join(options.output, 'predictions.json'))).toBe(false);
    const serialized = fs.readFileSync(options.checkpoint, 'utf8');
    for (const forbidden of [
      secret,
      'GEMINI_API_KEY',
      'sourceFiles',
      'targetFiles',
      'headers',
      'prompt contents',
      frozen.cases[0].sourceFiles[0].content,
    ])
      expect(serialized).not.toContain(forbidden);
  });
  it('resumes at the next exact case without rerunning/replacing a terminal result', async () => {
    const first = await runMultidayBenchmark(options);
    const next = await resume();
    expect(next.results[0]).toEqual(first.results[0]);
    expect(next.results.map((r) => r.caseId)).toEqual(
      frozen.cases.slice(0, 2).map((c) => c.caseId),
    );
    expect(validate.mock.calls.map((call) => call[0].conversionJobId)).toEqual(
      frozen.cases.slice(0, 2).map((c) => `ai-evaluation:${c.caseId}`),
    );
    expect(next.sessions).toHaveLength(2);
  });
  it.each([
    'SERVER_ERROR',
    'TIMEOUT',
    'NETWORK_ERROR',
    'AUTHENTICATION_FAILED',
    'REQUEST_REJECTED',
    'REFUSED',
    'INVALID_OUTPUT',
    'RATE_LIMITED',
  ] as const)('keeps %s terminal across sessions', async (kind) => {
    validate.mockRejectedValueOnce(
      providerFailure(kind, kind === 'RATE_LIMITED' ? 'UNKNOWN' : undefined),
    );
    const first = await runMultidayBenchmark(options);
    expect(first.results[0].status).toBe('PROVIDER_FAILED');
    const next = await resume();
    expect(next.nextIndex).toBe(2);
    expect(next.results[0]).toEqual(first.results[0]);
    expect(validate).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(next)).not.toContain(secret);
  });
  it('keeps invalid output and context validation failures terminal', async () => {
    validate.mockRejectedValueOnce(new AiValidatorError('AI_PROVIDER_RESPONSE_INVALID', secret));
    const first = await runMultidayBenchmark(options);
    expect(first.results[0].status).toBe('INVALID_OUTPUT');
    jest.spyOn(options.prepareContext, 'execute').mockImplementationOnce(() => {
      throw new BadRequestException(secret);
    });
    const second = await resume();
    expect(second.results[1].status).toBe('VALIDATION_FAILED');
    expect(second.nextIndex).toBe(2);
    expect(JSON.stringify(second)).not.toContain(secret);
  });
  it('pauses on exact daily quota, records safe event, and requires confirmation to retry SAME case', async () => {
    validate.mockRejectedValueOnce(providerFailure('RATE_LIMITED', 'DAILY_QUOTA'));
    const cp = await runMultidayBenchmark({ ...options, maxNewCases: 40 });
    expect(cp.state).toBe('PAUSED_DAILY_QUOTA');
    expect(cp.results).toEqual([]);
    expect(cp.nextIndex).toBe(0);
    expect(cp.quotaEvents).toHaveLength(1);
    expect(cp.quotaEvents[0]).toMatchObject({
      session: 1,
      caseId: frozen.cases[0].caseId,
      caseIndex: 0,
      diagnostics: {
        finalFailureClass: 'RATE_LIMITED',
        rateLimitScope: 'DAILY_QUOTA',
        attempts: 1,
      },
    });
    expect(validate).toHaveBeenCalledTimes(1);
    await expect(resume()).rejects.toThrow('--confirm-new-quota-window');
    expect(validate).toHaveBeenCalledTimes(1);
    const next = await resume({ confirmNewQuotaWindow: true });
    expect(next.nextIndex).toBe(1);
    expect(next.quotaEvents).toEqual(cp.quotaEvents);
    expect(next.sessions[1].confirmedNewQuotaWindow).toBe(true);
    expect(validate.mock.calls.map((c) => c[0].conversionJobId)).toEqual(
      Array(2).fill(`ai-evaluation:${frozen.cases[0].caseId}`),
    );
    expect(JSON.stringify(next)).not.toContain(secret);
  });
  it('requires both daily diagnostic fields and does not resume SHORT_WINDOW automatically', async () => {
    validate
      .mockRejectedValueOnce(providerFailure('TIMEOUT', 'DAILY_QUOTA'))
      .mockRejectedValueOnce(providerFailure('RATE_LIMITED', 'SHORT_WINDOW'));
    const cp = await runMultidayBenchmark({ ...options, maxNewCases: 2 });
    expect(cp.nextIndex).toBe(2);
    expect(cp.quotaEvents).toEqual([]);
  });
  it('requires new confirmation after each repeated quota boundary', async () => {
    validate.mockRejectedValue(providerFailure('RATE_LIMITED', 'DAILY_QUOTA'));
    await runMultidayBenchmark(options);
    const cp = await resume({ confirmNewQuotaWindow: true });
    expect(cp.quotaEvents).toHaveLength(2);
    expect(cp.results).toHaveLength(0);
    await expect(resume()).rejects.toThrow('confirm-new-quota-window');
    expect(validate).toHaveBeenCalledTimes(2);
  });
  it('fail-fast stores a terminal failure; next session advances rather than retries it', async () => {
    options.failFast = true;
    validate.mockRejectedValueOnce(providerFailure('SERVER_ERROR'));
    const cp = await runMultidayBenchmark({ ...options, maxNewCases: 40 });
    expect(cp.nextIndex).toBe(1);
    expect(cp.sessions[0].stopReason).toBe('FAIL_FAST');
    expect((await resume()).nextIndex).toBe(2);
  });
  it.each(['provider', 'model', 'promptVersion'] as const)(
    'rejects metadata change: %s',
    async (field) => {
      await runMultidayBenchmark(options);
      const meta = options.validator.getMetadata();
      options.validator.getMetadata = () => ({ ...meta, [field]: 'changed' });
      await expect(resume()).rejects.toThrow();
      expect(validate).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    'AI_MAX_RETRIES',
    'AI_TIMEOUT_MS',
    'AI_MAX_FINDINGS',
    'GEMINI_MIN_REQUEST_INTERVAL_MS',
    'AI_MAX_FILES',
    'AI_MAX_FILE_CHARS',
    'AI_MAX_TOTAL_CHARS',
  ])('rejects changed setting %s', async (field) => {
    await runMultidayBenchmark(options);
    options.config.set(field, options.config.getOrThrow<number>(field) + 1);
      await expect(resume()).rejects.toThrow(`settings.${field}`);
    expect(validate).toHaveBeenCalledTimes(1);
  });
  it.each(['datasetId', 'version', 'content', 'findings', 'order', 'count'])(
    'rejects dataset mutation %s',
    async (kind) => {
      await runMultidayBenchmark(options);
      if (kind === 'datasetId') options.dataset.datasetId += '-changed';
      if (kind === 'version') options.dataset.version = '9.0.0';
      if (kind === 'content') options.dataset.cases[0].sourceFiles[0].content += '\n';
      if (kind === 'findings')
        options.dataset.cases.find((c) => !c.isClean)!.expectedFindings[0].description +=
          ' changed';
      if (kind === 'order') options.dataset.cases.reverse();
      if (kind === 'count') {
        options.dataset.cases.pop();
        options.dataset.caseCount--;
      }
      options.datasetBytes = Buffer.from(JSON.stringify(options.dataset));
      await expect(resume()).rejects.toThrow();
      expect(validate).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    'evaluatorVersion',
    'matchingPolicyVersion',
    'executionPolicyVersion',
    'locationToleranceLines',
    'storageFingerprint',
    'failFast',
  ])('rejects checkpoint identity mismatch %s', async (key) => {
    const cp = await runMultidayBenchmark(options);
    const changed = structuredClone(cp);
    Object.assign(changed.identity, {
      [key]:
        key === 'locationToleranceLines'
          ? 3
          : key === 'failFast'
            ? true
            : key === 'storageFingerprint'
              ? 'a'.repeat(64)
              : 'changed',
    });
    expect(() => validateCheckpoint(changed, options.dataset, identity())).toThrow(
      `Resume mismatch: ${key}`,
    );
  });
  it('refuses stale IN_PROGRESS without another provider call or fabricating failure', async () => {
    // A crash after the provider returned but before terminal checkpoint commit.
    const durableSave = CheckpointStore.prototype.save;
    jest.spyOn(CheckpointStore.prototype, 'save').mockImplementation(function (
      this: CheckpointStore,
      cp: Checkpoint,
    ) {
      if (cp.results.length) throw new Error('simulated crash');
      return durableSave.call(this, cp);
    });
    await expect(runMultidayBenchmark(options)).rejects.toThrow('simulated crash');
    expect(read().state).toBe('IN_PROGRESS');
    await expect(resume()).rejects.toThrow('AMBIGUOUS_INTERRUPTION');
    expect(validate).toHaveBeenCalledTimes(1);
    expect(read().results).toHaveLength(0);
  });
  it('materializes only COMPLETE in exact order and existing scorer consumes it unchanged', async () => {
    const partial = await runMultidayBenchmark(options);
    expect(() => materializePredictions(partial, options.dataset, identity())).toThrow('Partial');
    const cp = await resume({ maxNewCases: 40 });
    expect(cp.state).toBe('COMPLETE');
    expect(cp.results).toHaveLength(40);
    const predictions = validatePredictions(
      JSON.parse(fs.readFileSync(join(options.output, 'predictions.json'), 'utf8')),
      options.dataset,
    );
    expect(predictions.cases.map((c) => c.caseId)).toEqual(frozen.cases.map((c) => c.caseId));
    expect(scoreEvaluation(options.dataset, predictions).execution.totalCases).toBe(40);
    const finalBytes = fs.readFileSync(join(options.output, 'predictions.json'));
    await resume();
    expect(validate).toHaveBeenCalledTimes(40);
    expect(fs.readFileSync(join(options.output, 'predictions.json'))).toEqual(finalBytes);
  });
  it('does not replace an existing conflicting final predictions file', async () => {
    await runMultidayBenchmark({ ...options, maxNewCases: 40 });
    fs.writeFileSync(join(options.output, 'predictions.json'), '{}');
    await expect(resume()).rejects.toThrow('cannot be replaced');
    expect(validate).toHaveBeenCalledTimes(40);
  });
  it.each([
    'unknown',
    'nextIndex',
    'duplicate',
    'outOfOrder',
    'incomplete',
    'missingEvent',
    'dailyTerminal',
    'extraDiagnostic',
    'missingIdentity',
  ])('rejects corrupt checkpoint %s', async (kind) => {
    const cp = await runMultidayBenchmark({ ...options, maxNewCases: 2 });
    const raw = cp as unknown as Record<string, unknown>;
    if (kind === 'unknown') raw.rawBody = secret;
    if (kind === 'nextIndex') cp.nextIndex = 3;
    if (kind === 'duplicate') cp.results[1] = cp.results[0];
    if (kind === 'outOfOrder') cp.results.reverse();
    if (kind === 'incomplete') cp.state = 'COMPLETE';
    if (kind === 'missingEvent') cp.state = 'PAUSED_DAILY_QUOTA';
    if (kind === 'dailyTerminal')
      cp.results[0] = {
        caseId: cp.identity.caseIds[0],
        status: 'PROVIDER_FAILED',
        failure: {
          code: 'AI_PROVIDER_UNAVAILABLE',
          message: 'Benchmark validation failed',
          diagnostics: providerFailure('RATE_LIMITED', 'DAILY_QUOTA').diagnostics,
        },
      };
    if (kind === 'extraDiagnostic')
      cp.quotaEvents.push({
        session: 1,
        caseId: cp.identity.caseIds[0],
        caseIndex: 0,
        timestamp: cp.updatedAt,
        diagnostics: {
          ...providerFailure('RATE_LIMITED', 'DAILY_QUOTA').diagnostics!,
          raw: secret,
        } as AiProviderDiagnostics,
      });
    if (kind === 'missingIdentity') delete raw.identity;
    expect(() => validateCheckpoint(cp, options.dataset, identity())).toThrow();
  });
  it('rejects replacing results or illegal transitions even when the replacement schema is valid', async () => {
    const cp = await runMultidayBenchmark(options);
    const modified = structuredClone(cp);
    modified.results[0].latencyMs = 999;
    expect(() => assertTransition(cp, modified)).toThrow('immutable terminal');
    const initial = initialCheckpoint(identity(), cp.createdAt);
    expect(() => assertTransition(initial, cp)).toThrow('transition');
  });
  it('invalid replacement leaves prior bytes intact', async () => {
    const cp = await runMultidayBenchmark(options);
    const before = fs.readFileSync(options.checkpoint);
    const store = CheckpointStore.acquire(
      options.checkpoint,
      options.output,
      options.dataset,
      identity(),
      root,
    );
    try {
      store.load(true);
      cp.nextIndex = 5;
      expect(() => store.save(cp)).toThrow();
    } finally {
      store.close();
    }
    expect(fs.readFileSync(options.checkpoint)).toEqual(before);
  });
  it('failed atomic rename preserves prior checkpoint and removes only its temporary file', async () => {
    await runMultidayBenchmark(options);
    const before = fs.readFileSync(options.checkpoint);
    const spy = jest.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw new Error('simulated rename failure');
    });
    await expect(resume()).rejects.toThrow('simulated rename failure');
    expect(fs.readFileSync(options.checkpoint)).toEqual(before);
    expect(fs.readdirSync(options.output)).toEqual(['checkpoint.json']);
    spy.mockRestore();
    await resume();
    expect(validate).toHaveBeenCalledTimes(2);
  });
  it('refuses concurrent writers/stale locks and does not delete their lock', async () => {
    const store = CheckpointStore.acquire(
      options.checkpoint,
      options.output,
      options.dataset,
      identity(),
      root,
    );
    try {
      await expect(runMultidayBenchmark(options)).rejects.toThrow('session lock');
      expect(fs.existsSync(join(options.output, '.session.lock'))).toBe(true);
    } finally {
      store.close();
    }
    expect(validate).not.toHaveBeenCalled();
  });
  it('failed temp write preserves prior checkpoint without starting another case', async () => {
    await runMultidayBenchmark(options);
    const before = fs.readFileSync(options.checkpoint);
    const write = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {
      throw new Error('simulated write failure');
    });
    await expect(resume()).rejects.toThrow('simulated write failure');
    expect(validate).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(options.checkpoint)).toEqual(before);
    expect(fs.readdirSync(options.output)).toEqual(['checkpoint.json']);
    write.mockRestore();
  });
  it('resumes READY after an interrupted between-case stop without rerunning completed cases', async () => {
    const realSave = CheckpointStore.prototype.save;
    const save = jest.spyOn(CheckpointStore.prototype, 'save').mockImplementation(function (
      this: CheckpointStore,
      cp: Checkpoint,
    ) {
      if (cp.state === 'IN_PROGRESS' && cp.nextIndex === 1)
        throw new Error('between-case interruption');
      realSave.call(this, cp);
    });
    await expect(runMultidayBenchmark({ ...options, maxNewCases: 40 })).rejects.toThrow(
      'between-case interruption',
    );
    expect(read().state).toBe('READY');
    expect(read().nextIndex).toBe(1);
    save.mockRestore();
    const cp = await resume();
    expect(cp.nextIndex).toBe(2);
    expect(cp.sessions[0].stopReason).toBe('INTERRUPTED_BETWEEN_CASES');
    expect(validate).toHaveBeenCalledTimes(2);
  });
  it('rejects in-progress state with no session and preserves complete immutability', async () => {
    const cp = initialCheckpoint(identity(), '2026-10-06T00:00:00.000Z');
    cp.state = 'IN_PROGRESS';
    expect(() => validateCheckpoint(cp, options.dataset, identity())).toThrow(
      'in-progress session',
    );
    const complete = await runMultidayBenchmark({ ...options, maxNewCases: 40 });
    expect(() => assertTransition(complete, structuredClone(complete))).toThrow('immutable');
  });
  it('rejects a copied run at another location without provider calls', async () => {
    const cp = await runMultidayBenchmark(options);
    const output = join(root, 'evaluation/ai-validation/results/multiday/another-run');
    fs.mkdirSync(output);
    fs.writeFileSync(join(output, 'checkpoint.json'), JSON.stringify(cp));
    await expect(resume({ checkpoint: join(output, 'checkpoint.json'), output })).rejects.toThrow(
      'storageFingerprint',
    );
    expect(validate).toHaveBeenCalledTimes(1);
  });
  it('legacy runs cannot overwrite the dedicated multiday output namespace', () => {
    expect(() => assertLegacyOutputOutsideMultiday(options.output, root)).toThrow('--checkpoint');
    expect(() =>
      assertLegacyOutputOutsideMultiday(
        join(root, 'evaluation/ai-validation/results/legacy'),
        root,
      ),
    ).not.toThrow();
  });
  it('refuses initialization over old outputs and refuses missing resume', async () => {
    await expect(resume()).rejects.toThrow('existing checkpoint');
    fs.writeFileSync(join(options.output, 'predictions.json'), '{}');
    await expect(runMultidayBenchmark(options)).rejects.toThrow('empty output');
    expect(validate).not.toHaveBeenCalled();
  });
  it('refuses unsafe locations and changed output directories', async () => {
    await expect(
      runMultidayBenchmark({ ...options, checkpoint: join(root, 'checkpoint.json') }),
    ).rejects.toThrow('Checkpoint must');
    await runMultidayBenchmark(options);
    await expect(resume({ output: join(options.output, 'elsewhere') })).rejects.toThrow(
      'Checkpoint must',
    );
  });
});

describe('resumable CLI safeguards', () => {
  it.each([
    ['--checkpoint', 'x', '--case', 'one'],
    ['--checkpoint', 'x', '--all', '--limit', '2'],
    ['--all', '--resume'],
    ['--all', '--max-new-cases', '2'],
    ['--all', '--checkpoint', 'x', '--confirm-new-quota-window'],
    ['--all', '--checkpoint', 'x', '--max-new-cases', '0'],
    ['--all', '--checkpoint', 'x', '--max-new-cases', '1.5'],
    ['--all', '--checkpoint', 'x', '--max-new-cases', '41'],
  ])('rejects incompatible arguments %j', (...args) => {
    expect(() => parseLiveArguments(args)).toThrow();
  });
  it('supports full resumable mode and preserves legacy selections', () => {
    expect(
      parseLiveArguments([
        '--all',
        '--checkpoint',
        'x',
        '--resume',
        '--confirm-new-quota-window',
        '--max-new-cases',
        '3',
      ]),
    ).toMatchObject({ all: true, resume: true, confirmNewQuotaWindow: true, maxNewCases: 3 });
    expect(parseLiveArguments(['--case', 'one'])).toMatchObject({ caseId: 'one' });
    expect(parseLiveArguments(['--limit', '2'])).toMatchObject({ limit: 2 });
    expect(parseLiveArguments(['--all'])).toMatchObject({ all: true });
  });
  it('retains both live opt-ins', () => {
    expect(() => assertLiveProviderOptIn({}, true)).toThrow();
    expect(() => assertLiveProviderOptIn({ AI_EVAL_ALLOW_LIVE_PROVIDER: 'true' }, false)).toThrow();
    expect(() =>
      assertLiveProviderOptIn({ AI_EVAL_ALLOW_LIVE_PROVIDER: 'true' }, true),
    ).not.toThrow();
  });
});
