import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { GeminiJsonClient } from '../src/modules/validation/infrastructure/gemini-json.client';
import { GeminiAiValidatorAdapter } from '../src/modules/validation/infrastructure/gemini-ai-validator.adapter';
import { BmsAiValidatorAdapter } from '../src/modules/validation/infrastructure/bms-ai-validator.adapter';
import { ExecuteAiValidationService } from '../src/modules/validation/application/execute-ai-validation.service';
import { ValidationWorkerRunner } from '../src/modules/validation/infrastructure/validation-worker.runner';
import { ConversionType } from '../src/modules/projects/domain/project.types';
import { ValidationRunStatus } from '../src/modules/validation/domain/validation-run.types';

describe('application Gemini budget across adapters and BullMQ (closed fake HTTP)', () => {
  const input = {
    conversionJobId: 'job',
    sourceFiles: [{ path: 'SCREEN.bms', content: '1 | DFHMDF', lineCount: 1 }],
    targetFiles: [{ path: 'Screen.tsx', content: '1 | <input />', lineCount: 1 }],
  };
  const config = () =>
    new ConfigService({
      AI_VALIDATION_ENABLED: true,
      AI_PROVIDER: 'gemini',
      GEMINI_MODEL: 'reviewed-model',
      GEMINI_ALLOWED_MODELS: 'reviewed-model',
      GEMINI_API_KEY: 'synthetic-private-key',
      AI_TIMEOUT_MS: 1000,
      AI_MAX_RETRIES: 2,
      GEMINI_MIN_REQUEST_INTERVAL_MS: 0,
      AI_MAX_FINDINGS: 5,
      VALIDATION_JOB_ATTEMPTS: 5,
    });
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(Math, 'random').mockReturnValue(0);
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  function worker(type: 'bms' | 'cobol', settings = config()) {
    const client = new GeminiJsonClient(settings);
    const validator =
      type === 'bms'
        ? new BmsAiValidatorAdapter(settings, client)
        : new GeminiAiValidatorAdapter(settings, client);
    const state = {
      id: 'run',
      projectId: 'project',
      organizationId: 'org',
      conversionJobId: 'job',
      status: ValidationRunStatus.QUEUED,
      ...validator.getMetadata(),
    };
    let claimed = false;
    const runs = {
      findById: jest.fn(async () => state),
      markProcessing: jest.fn(async () => {
        state.status = ValidationRunStatus.PROCESSING;
        return state;
      }),
      claimProviderExecution: jest.fn(async () => {
        if (claimed) return false;
        claimed = true;
        return true;
      }),
      markResultsPersisted: jest.fn(async () => true),
      markFailed: jest.fn(async (_id, _project, _org, failure) => {
        state.status = ValidationRunStatus.FAILED;
        Object.assign(state, failure);
      }),
    };
    const service = new ExecuteAiValidationService(
      {
        execute: async () => ({
          conversionType:
            type === 'bms' ? ConversionType.BMS_DSPF_TO_FRONTEND : ConversionType.COBOL_TO_JAVA,
        }),
      } as never,
      {
        execute: () => ({
          input,
          selectedFileCount: 2,
          redactionCount: 0,
          inputCharacterCount: 20,
        }),
      } as never,
      { assertAvailable: () => validator.getMetadata() } as never,
      {
        execute: async () => {
          state.status = ValidationRunStatus.COMPLETED;
          return 0;
        },
      } as never,
      validator,
      validator,
      runs as never,
      { countByRun: async () => 0, upsertManyForRun: async () => undefined } as never,
    );
    const runner = new ValidationWorkerRunner(settings, runs as never, service);
    const job = {
      data: {
        validationRunId: 'run',
        projectId: 'project',
        organizationId: 'org',
        conversionJobId: 'job',
      },
      opts: { attempts: 5 },
      attemptsMade: 0,
    };
    return {
      state,
      runs,
      process: () => (runner as unknown as { process(job: unknown): Promise<void> }).process(job),
    };
  }

  it.each(['bms', 'cobol'] as const)(
    '%s does not multiply exhausted adapter retries through BullMQ',
    async (type) => {
      const fetchMock = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue({ ok: false, status: 503 } as Response);
      const execution = worker(type);
      const pending = execution.process();
      await jest.runAllTimersAsync();
      await pending;
      await execution.process(); // delivery of the same completed/failed job is harmless
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(execution.state.status).toBe(type === 'bms' ? 'COMPLETED' : 'FAILED');
      if (type === 'bms')
        expect(execution.runs.markResultsPersisted).toHaveBeenCalledWith(
          'run',
          'project',
          'org',
          expect.objectContaining({
            executionOutcome: 'HEURISTIC_FALLBACK',
            resultProvider: 'heuristic-fallback',
            providerFailureCode: 'AI_PROVIDER_UNAVAILABLE',
          }),
        );
      for (const [url, init] of fetchMock.mock.calls) {
        expect(url).toContain('/reviewed-model:generateContent');
        expect(String(url)).not.toContain('synthetic-private-key');
        expect((init?.headers as Record<string, string>)['x-goog-api-key']).toBe(
          'synthetic-private-key',
        );
      }
    },
  );

  it.each(['bms', 'cobol'] as const)(
    '%s daily quota is nonretryable through the worker',
    async (type) => {
      const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 429,
        headers: new Headers({ 'Retry-After': '1' }),
        json: async () => ({
          error: {
            status: 'RESOURCE_EXHAUSTED',
            details: [
              {
                '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
                violations: [
                  {
                    quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier',
                  },
                ],
              },
            ],
          },
        }),
      } as Response);
      const execution = worker(type);
      const pending = execution.process();
      await jest.runAllTimersAsync();
      await pending;
      await execution.process();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      if (type === 'cobol')
        expect(execution.runs.markFailed).toHaveBeenCalledWith(
          'run',
          'project',
          'org',
          expect.objectContaining({ failureCode: 'AI_PROVIDER_DAILY_QUOTA_EXCEEDED' }),
        );
      else
        expect(execution.runs.markResultsPersisted).toHaveBeenCalledWith(
          'run',
          'project',
          'org',
          expect.objectContaining({ providerFailureCode: 'AI_PROVIDER_DAILY_QUOTA_EXCEEDED' }),
        );
    },
  );

  it.each([0, 2, 5])('both validators honor AI_MAX_RETRIES=%i', async (retries) => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({ ok: false, status: 503 } as Response);
    for (const Adapter of [BmsAiValidatorAdapter, GeminiAiValidatorAdapter]) {
      fetchMock.mockClear();
      const settings = config();
      settings.set('AI_MAX_RETRIES', retries);
      const pending = new Adapter(settings).validate(input).catch((error) => error);
      await jest.runAllTimersAsync();
      await pending;
      expect(fetchMock).toHaveBeenCalledTimes(retries + 1);
    }
  });

  it('rejects an unreviewed model without dispatch or hidden substitution', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch');
    const settings = config();
    settings.set('GEMINI_MODEL', 'unreviewed-model');
    await expect(new GeminiAiValidatorAdapter(settings).validate(input)).rejects.toMatchObject({
      code: 'AI_PROVIDER_REQUEST_REJECTED',
    });
    expect((await new BmsAiValidatorAdapter(settings).validate(input)).execution).toMatchObject({
      outcome: 'HEURISTIC_FALLBACK',
      providerFailureCode: 'AI_PROVIDER_REQUEST_REJECTED',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['bms', 'cobol'] as const)(
    '%s bounds timeout attempts and keeps transport errors private',
    async (type) => {
      const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new Error('synthetic-private-transport-body')),
            );
          }),
      );
      const settings = config();
      settings.set('AI_MAX_RETRIES', 1);
      const execution = worker(type, settings);
      const pending = execution.process();
      await jest.runAllTimersAsync();
      await pending;
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const failureCall =
        type === 'bms'
          ? execution.runs.markResultsPersisted.mock.calls
          : execution.runs.markFailed.mock.calls;
      expect(JSON.stringify(failureCall)).toContain('AI_PROVIDER_TIMEOUT');
      expect(JSON.stringify(failureCall)).not.toContain('synthetic-private-transport-body');
    },
  );

  it.each(['bms', 'cobol'] as const)(
    '%s prevents redispatch after an interrupted result write',
    async (type) => {
      const fetchMock = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: '{"findings":[]}' }] } }],
          }),
        } as Response);
      const execution = worker(type);
      execution.runs.markResultsPersisted.mockRejectedValueOnce(
        new Error('synthetic interrupted write'),
      );
      await expect(execution.process()).rejects.toMatchObject({ retryable: true });
      await execution.process();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(execution.runs.markFailed).toHaveBeenCalledWith(
        'run',
        'project',
        'org',
        expect.objectContaining({ failureCode: 'VALIDATION_PROVIDER_EXECUTION_UNCONFIRMED' }),
      );
    },
  );

  it('shares request-start pacing across both adapters in one process', async () => {
    const starts: number[] = [];
    jest.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      starts.push(Date.now());
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"findings":[]}' }] } }],
        }),
      } as Response;
    });
    const settings = config();
    settings.set('GEMINI_MIN_REQUEST_INTERVAL_MS', 1000);
    const client = new GeminiJsonClient(settings);
    const pending = Promise.all([
      new GeminiAiValidatorAdapter(settings, client).validate(input),
      new BmsAiValidatorAdapter(settings, client).validate(input),
    ]);
    await jest.runAllTimersAsync();
    await pending;
    expect(starts).toHaveLength(2);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(1000);
  });
});
