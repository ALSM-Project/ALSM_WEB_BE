import { ConfigService } from '@nestjs/config';
import { Worker } from 'bullmq';
import { environmentValidationSchema } from '../src/config/environment.validation';
import { ConversionWorkerRunner } from '../src/modules/conversions/infrastructure/conversion-worker.runner';
import {
  ConversionEnginePort,
  ConversionJobRepository,
  ConversionQueuePort,
} from '../src/modules/conversions/domain/conversion-job.types';
import { ScreenRepository, ScreenStatus } from '../src/modules/screens/domain/screen.types';

type Processor = (job: {
  data: { conversionJobId: string; executionGeneration?: number };
  attemptsMade?: number;
  opts?: { attempts?: number };
}) => Promise<void>;
let capturedProcessor: Processor | undefined;

jest.mock('bullmq', () => ({
  UnrecoverableError: jest.requireActual('bullmq').UnrecoverableError,
  Worker: jest.fn().mockImplementation((_name: string, processor: Processor) => {
    capturedProcessor = processor;
    return { close: jest.fn(), on: jest.fn() };
  }),
}));

describe('ConversionWorkerRunner', () => {
  const jobs = {
    markProcessing: jest.fn(),
    listDeliveryRecoveryCandidates: jest.fn().mockResolvedValue([]),
    markUndeliveredFailed: jest.fn(),
    markFailed: jest.fn(),
    markCompleted: jest.fn(),
    renewProcessingLease: jest.fn(),
    releaseProcessingForRetry: jest.fn(),
    findByIdAnyOrganization: jest.fn(),
  };
  const queue = { deliveryState: jest.fn() };
  const engine = { execute: jest.fn() };
  const screens = { updateStatus: jest.fn() };
  const enabledValues: Record<string, unknown> = {
    CONVERSION_WORKER_ENABLED: true,
    REDIS_HOST: 'localhost',
    REDIS_PORT: 6379,
  };
  const enabledConfig = {
    get: jest.fn((key: string) => enabledValues[key]),
    getOrThrow: jest.fn((key: string) => enabledValues[key]),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    capturedProcessor = undefined;
    jobs.markFailed.mockResolvedValue(true);
    jobs.markCompleted.mockResolvedValue({ id: '0123456789abcdef01234567' });
    jobs.releaseProcessingForRetry.mockResolvedValue(true);
    jobs.findByIdAnyOrganization.mockResolvedValue({ status: 'CANCELLED' });
  });

  function runner() {
    return new ConversionWorkerRunner(
      enabledConfig as unknown as ConfigService,
      jobs as unknown as ConversionJobRepository,
      engine as unknown as ConversionEnginePort,
      screens as unknown as ScreenRepository,
      queue as unknown as ConversionQueuePort,
    );
  }

  it.each([-1, 0.5, NaN, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid generation %s before Mongo access',
    async (executionGeneration) => {
      const worker = runner();
      worker.start();
      await expect(
        capturedProcessor!({
          data: { conversionJobId: '0123456789abcdef01234567', executionGeneration },
        }),
      ).rejects.toThrow('Invalid conversion queue payload');
      expect(jobs.markProcessing).not.toHaveBeenCalled();
      await worker.onModuleDestroy();
    },
  );

  it('rejects malformed IDs and missing records without executing the engine', async () => {
    const worker = runner();
    worker.start();
    await expect(capturedProcessor!({ data: { conversionJobId: 'invalid' } })).rejects.toThrow(
      'Invalid conversion queue payload',
    );
    jobs.markProcessing.mockResolvedValue(null);
    jobs.findByIdAnyOrganization.mockResolvedValue(null);
    await expect(
      capturedProcessor!({ data: { conversionJobId: '0123456789abcdef01234567' } }),
    ).rejects.toThrow('record was not found');
    expect(engine.execute).not.toHaveBeenCalled();
    await worker.onModuleDestroy();
  });

  it('ignores an old generation even when the new generation is processing', async () => {
    const worker = runner();
    worker.start();
    jobs.markProcessing.mockResolvedValue(null);
    jobs.findByIdAnyOrganization.mockResolvedValue({
      status: 'PROCESSING',
      executionGeneration: 2,
    });
    await expect(
      capturedProcessor!({
        data: { conversionJobId: '0123456789abcdef01234567', executionGeneration: 1 },
      }),
    ).resolves.toBeUndefined();
    expect(engine.execute).not.toHaveBeenCalled();
    await worker.onModuleDestroy();
  });

  it('does not report screen failure when Mongo rejects a stale lease', async () => {
    const worker = runner();
    jobs.markProcessing.mockResolvedValue({
      id: '0123456789abcdef01234567',
      organizationId: 'org',
      screenId: 'screen',
    });
    jobs.markFailed.mockResolvedValue(false);
    engine.execute.mockRejectedValue(new Error('fixture failure'));
    worker.start();
    await expect(
      capturedProcessor!({
        data: { conversionJobId: '0123456789abcdef01234567' },
        opts: { attempts: 1 },
        attemptsMade: 0,
      }),
    ).rejects.toThrow('fixture failure');
    expect(screens.updateStatus).not.toHaveBeenCalledWith('screen', 'org', ScreenStatus.FAILED);
    await worker.onModuleDestroy();
  });

  it('renews the lease and fences persistence after renewal is lost', async () => {
    jest.useFakeTimers();
    const worker = runner();
    jobs.markProcessing.mockResolvedValue({ id: '0123456789abcdef01234567' });
    jobs.renewProcessingLease.mockResolvedValueOnce(true).mockResolvedValue(false);
    let finish!: (output: { resultReference: string }) => void;
    engine.execute.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    worker.start();
    try {
      const processing = capturedProcessor!({
        data: { conversionJobId: '0123456789abcdef01234567' },
      });
      const rejected = expect(processing).rejects.toThrow('lease was lost');
      await jest.advanceTimersByTimeAsync(20000);
      expect(jobs.renewProcessingLease).toHaveBeenCalledTimes(2);
      finish({ resultReference: 'fixture-only' });
      await rejected;
      expect(jobs.markCompleted).not.toHaveBeenCalled();
      expect(jobs.markFailed).not.toHaveBeenCalled();
      expect(jobs.releaseProcessingForRetry).not.toHaveBeenCalled();
    } finally {
      await worker.onModuleDestroy();
      jest.useRealTimers();
    }
  });

  it('starts only one worker and closes it on shutdown', async () => {
    const worker = runner();
    worker.start();
    worker.start();
    expect(Worker).toHaveBeenCalledTimes(1);
    await worker.onModuleDestroy();
  });

  it('fails only unreachable recovery candidates and keeps pending deliveries', async () => {
    jobs.listDeliveryRecoveryCandidates.mockResolvedValueOnce([
      { id: 'orphan', status: 'QUEUED', executionGeneration: 2 },
      { id: 'pending', status: 'QUEUED', executionGeneration: 0 },
      { id: 'expired', status: 'PROCESSING', executionGeneration: 1 },
    ]);
    queue.deliveryState
      .mockResolvedValueOnce('missing')
      .mockResolvedValueOnce('pending')
      .mockResolvedValueOnce('terminal');
    const abandoned = jest.fn();
    const worker = new ConversionWorkerRunner(
      enabledConfig as unknown as ConfigService,
      { ...jobs, markAbandonedFailed: abandoned } as unknown as ConversionJobRepository,
      engine as unknown as ConversionEnginePort,
      screens as unknown as ScreenRepository,
      queue as unknown as ConversionQueuePort,
    );
    worker.start();
    await worker.onModuleDestroy();
    expect(jobs.markUndeliveredFailed).toHaveBeenCalledTimes(1);
    expect(jobs.markUndeliveredFailed).toHaveBeenCalledWith('orphan', 2, expect.any(Date));
    expect(abandoned).toHaveBeenCalledWith('expired', 1);
  });

  it('does not create a worker when CONVERSION_WORKER_ENABLED is false', () => {
    const disabledConfig = { get: jest.fn(() => false), getOrThrow: jest.fn() };
    const runner = new ConversionWorkerRunner(
      disabledConfig as unknown as ConfigService,
      jobs as unknown as ConversionJobRepository,
      engine as unknown as ConversionEnginePort,
      screens as unknown as ScreenRepository,
      queue as unknown as ConversionQueuePort,
    );

    runner.start();

    expect(capturedProcessor).toBeUndefined();
  });

  it('validates worker Redis settings before application startup', () => {
    expect(environmentValidationSchema.extract('REDIS_HOST').validate('').error).toBeDefined();
    expect(environmentValidationSchema.extract('REDIS_PORT').validate(70000).error).toBeDefined();
    expect(
      environmentValidationSchema.extract('CONVERSION_WORKER_ENABLED').validate('not-a-boolean')
        .error,
    ).toBeDefined();
    expect(
      environmentValidationSchema.extract('CONVERSION_WORKER_ENABLED').validate('true').value,
    ).toBe(true);
  });

  it('persists resultReference/toolVersion via markCompleted when the engine succeeds', async () => {
    const runner = new ConversionWorkerRunner(
      enabledConfig as unknown as ConfigService,
      jobs as unknown as ConversionJobRepository,
      engine as unknown as ConversionEnginePort,
      screens as unknown as ScreenRepository,
      queue as unknown as ConversionQueuePort,
    );
    jobs.markProcessing.mockResolvedValue({
      id: '0123456789abcdef01234567',
      organizationId: 'org-1',
      projectId: 'p1',
      screenId: 'scr-1',
      conversionType: 'BMS_DSPF_TO_FRONTEND',
    });
    engine.execute.mockResolvedValue({
      resultReference: 'results/p1/0123456789abcdef01234567',
      toolVersion: 'convert2fe',
    });

    runner.start();
    expect(capturedProcessor).toBeDefined();
    await capturedProcessor!({ data: { conversionJobId: '0123456789abcdef01234567' } });

    expect(jobs.markCompleted).toHaveBeenCalledWith(
      '0123456789abcdef01234567',
      {
        resultReference: 'results/p1/0123456789abcdef01234567',
        toolVersion: 'convert2fe',
      },
      undefined,
      expect.any(String),
    );
    expect(jobs.markFailed).not.toHaveBeenCalled();
    expect(screens.updateStatus).toHaveBeenNthCalledWith(
      1,
      'scr-1',
      'org-1',
      ScreenStatus.PROCESSING,
    );
    expect(screens.updateStatus).toHaveBeenNthCalledWith(
      2,
      'scr-1',
      'org-1',
      ScreenStatus.COMPLETED,
    );
  });

  it('marks the job failed and rethrows when the engine rejects on the final attempt', async () => {
    const runner = new ConversionWorkerRunner(
      enabledConfig as unknown as ConfigService,
      jobs as unknown as ConversionJobRepository,
      engine as unknown as ConversionEnginePort,
      screens as unknown as ScreenRepository,
      queue as unknown as ConversionQueuePort,
    );
    jobs.markProcessing.mockResolvedValue({
      id: '0123456789abcdef01234567',
      organizationId: 'org-1',
      projectId: 'p1',
      conversionType: 'BMS_DSPF_TO_FRONTEND',
    });
    engine.execute.mockRejectedValue(new Error('tool crashed'));

    runner.start();
    await expect(
      capturedProcessor!({
        data: { conversionJobId: '0123456789abcdef01234567' },
        attemptsMade: 2,
        opts: { attempts: 3 },
      }),
    ).rejects.toThrow('tool crashed');

    expect(jobs.markFailed).toHaveBeenCalledWith(
      '0123456789abcdef01234567',
      'CONVERSION_ENGINE_UNAVAILABLE',
      'tool crashed',
      expect.any(String),
    );
    expect(jobs.markCompleted).not.toHaveBeenCalled();
    // No screenId on this job — status sync must be skipped entirely, not called with undefined.
    expect(screens.updateStatus).not.toHaveBeenCalled();
  });

  // UC-101 regression test. Bug: BullMQ redelivers the SAME job to this SAME callback for
  // each backoff attempt — it never calls markProcessing() again itself. If markFailed() ran
  // on a non-final attempt, the job left the QUEUED/PROCESSING set, so the next redelivered
  // attempt's markProcessing() found nothing, returned null, and the callback exited without
  // throwing — BullMQ then treated that attempt as a *success* and silently stopped
  // retrying, despite attempts still being configured. Confirmed by reading markProcessing's
  // Mongo filter (`status: { $in: [QUEUED, PROCESSING] }`) against what markFailed sets.
  it('does not mark the job failed on a non-final attempt, so BullMQ backoff can actually retry it', async () => {
    const runner = new ConversionWorkerRunner(
      enabledConfig as unknown as ConfigService,
      jobs as unknown as ConversionJobRepository,
      engine as unknown as ConversionEnginePort,
      screens as unknown as ScreenRepository,
      queue as unknown as ConversionQueuePort,
    );
    jobs.markProcessing.mockResolvedValue({
      id: '0123456789abcdef01234567',
      organizationId: 'org-1',
      projectId: 'p1',
      screenId: 'scr-1',
      conversionType: 'BMS_DSPF_TO_FRONTEND',
    });
    engine.execute.mockRejectedValue(new Error('tool crashed'));

    runner.start();
    // attemptsMade: 0 with attempts: 3 means this is the FIRST of 3 attempts — BullMQ will
    // redeliver this same job twice more, so the Mongo record must stay processable.
    await expect(
      capturedProcessor!({
        data: { conversionJobId: '0123456789abcdef01234567' },
        attemptsMade: 0,
        opts: { attempts: 3 },
      }),
    ).rejects.toThrow('tool crashed');

    expect(jobs.markFailed).not.toHaveBeenCalled();
    expect(jobs.releaseProcessingForRetry).toHaveBeenCalledWith(
      '0123456789abcdef01234567',
      expect.any(String),
    );
    // The PROCESSING sync from the start of this attempt is fine; FAILED must not fire yet.
    expect(screens.updateStatus).not.toHaveBeenCalledWith('scr-1', 'org-1', ScreenStatus.FAILED);
  });

  it('does not let a screen-status-sync failure break job completion (best-effort only)', async () => {
    const runner = new ConversionWorkerRunner(
      enabledConfig as unknown as ConfigService,
      jobs as unknown as ConversionJobRepository,
      engine as unknown as ConversionEnginePort,
      screens as unknown as ScreenRepository,
      queue as unknown as ConversionQueuePort,
    );
    jobs.markProcessing.mockResolvedValue({
      id: '0123456789abcdef01234567',
      organizationId: 'org-1',
      projectId: 'p1',
      screenId: 'scr-1',
      conversionType: 'BMS_DSPF_TO_FRONTEND',
    });
    engine.execute.mockResolvedValue({ resultReference: 'results/p1/0123456789abcdef01234567' });
    screens.updateStatus.mockRejectedValue(new Error('screens collection unavailable'));

    runner.start();
    await expect(
      capturedProcessor!({ data: { conversionJobId: '0123456789abcdef01234567' } }),
    ).resolves.toBeUndefined();

    expect(jobs.markCompleted).toHaveBeenCalledWith(
      '0123456789abcdef01234567',
      {
        resultReference: 'results/p1/0123456789abcdef01234567',
      },
      undefined,
      expect.any(String),
    );
  });

  it('skips processing when the job could not be marked processing (already consumed/cancelled)', async () => {
    const runner = new ConversionWorkerRunner(
      enabledConfig as unknown as ConfigService,
      jobs as unknown as ConversionJobRepository,
      engine as unknown as ConversionEnginePort,
      screens as unknown as ScreenRepository,
      queue as unknown as ConversionQueuePort,
    );
    jobs.markProcessing.mockResolvedValue(null);

    runner.start();
    await capturedProcessor!({ data: { conversionJobId: '0123456789abcdef01234567' } });

    expect(engine.execute).not.toHaveBeenCalled();
    expect(jobs.markCompleted).not.toHaveBeenCalled();
    expect(jobs.markFailed).not.toHaveBeenCalled();
  });
});
