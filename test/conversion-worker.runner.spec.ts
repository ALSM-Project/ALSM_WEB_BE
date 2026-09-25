import { ConfigService } from '@nestjs/config';
import { ConversionWorkerRunner } from '../src/modules/conversions/infrastructure/conversion-worker.runner';
import {
  ConversionEnginePort,
  ConversionJobRepository,
} from '../src/modules/conversions/domain/conversion-job.types';
import { ScreenRepository, ScreenStatus } from '../src/modules/screens/domain/screen.types';

type Processor = (job: {
  data: { conversionJobId: string };
  attemptsMade?: number;
  opts?: { attempts?: number };
}) => Promise<void>;
let capturedProcessor: Processor | undefined;

jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation((_name: string, processor: Processor) => {
    capturedProcessor = processor;
    return { close: jest.fn() };
  }),
}));

describe('ConversionWorkerRunner', () => {
  const jobs = { markProcessing: jest.fn(), markFailed: jest.fn(), markCompleted: jest.fn() };
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
  });

  it('does not create a worker when CONVERSION_WORKER_ENABLED is false', () => {
    const disabledConfig = { get: jest.fn(() => false), getOrThrow: jest.fn() };
    const runner = new ConversionWorkerRunner(
      disabledConfig as unknown as ConfigService,
      jobs as unknown as ConversionJobRepository,
      engine as unknown as ConversionEnginePort,
      screens as unknown as ScreenRepository,
    );

    runner.start();

    expect(capturedProcessor).toBeUndefined();
  });

  it('persists resultReference/toolVersion via markCompleted when the engine succeeds', async () => {
    const runner = new ConversionWorkerRunner(
      enabledConfig as unknown as ConfigService,
      jobs as unknown as ConversionJobRepository,
      engine as unknown as ConversionEnginePort,
      screens as unknown as ScreenRepository,
    );
    jobs.markProcessing.mockResolvedValue({
      id: 'job-1',
      organizationId: 'org-1',
      projectId: 'p1',
      screenId: 'scr-1',
      conversionType: 'BMS_DSPF_TO_FRONTEND',
    });
    engine.execute.mockResolvedValue({ resultReference: 'results/p1/job-1', toolVersion: 'convert2fe' });

    runner.start();
    expect(capturedProcessor).toBeDefined();
    await capturedProcessor!({ data: { conversionJobId: 'job-1' } });

    expect(jobs.markCompleted).toHaveBeenCalledWith('job-1', {
      resultReference: 'results/p1/job-1',
      toolVersion: 'convert2fe',
    });
    expect(jobs.markFailed).not.toHaveBeenCalled();
    expect(screens.updateStatus).toHaveBeenNthCalledWith(1, 'scr-1', 'org-1', ScreenStatus.PROCESSING);
    expect(screens.updateStatus).toHaveBeenNthCalledWith(2, 'scr-1', 'org-1', ScreenStatus.COMPLETED);
  });

  it('marks the job failed and rethrows when the engine rejects on the final attempt', async () => {
    const runner = new ConversionWorkerRunner(
      enabledConfig as unknown as ConfigService,
      jobs as unknown as ConversionJobRepository,
      engine as unknown as ConversionEnginePort,
      screens as unknown as ScreenRepository,
    );
    jobs.markProcessing.mockResolvedValue({
      id: 'job-1',
      organizationId: 'org-1',
      projectId: 'p1',
      conversionType: 'BMS_DSPF_TO_FRONTEND',
    });
    engine.execute.mockRejectedValue(new Error('tool crashed'));

    runner.start();
    await expect(
      capturedProcessor!({ data: { conversionJobId: 'job-1' }, attemptsMade: 2, opts: { attempts: 3 } }),
    ).rejects.toThrow('tool crashed');

    expect(jobs.markFailed).toHaveBeenCalledWith('job-1', 'CONVERSION_ENGINE_UNAVAILABLE', 'tool crashed');
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
    );
    jobs.markProcessing.mockResolvedValue({
      id: 'job-1',
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
      capturedProcessor!({ data: { conversionJobId: 'job-1' }, attemptsMade: 0, opts: { attempts: 3 } }),
    ).rejects.toThrow('tool crashed');

    expect(jobs.markFailed).not.toHaveBeenCalled();
    // The PROCESSING sync from the start of this attempt is fine; FAILED must not fire yet.
    expect(screens.updateStatus).not.toHaveBeenCalledWith('scr-1', 'org-1', ScreenStatus.FAILED);
  });

  it('does not let a screen-status-sync failure break job completion (best-effort only)', async () => {
    const runner = new ConversionWorkerRunner(
      enabledConfig as unknown as ConfigService,
      jobs as unknown as ConversionJobRepository,
      engine as unknown as ConversionEnginePort,
      screens as unknown as ScreenRepository,
    );
    jobs.markProcessing.mockResolvedValue({
      id: 'job-1',
      organizationId: 'org-1',
      projectId: 'p1',
      screenId: 'scr-1',
      conversionType: 'BMS_DSPF_TO_FRONTEND',
    });
    engine.execute.mockResolvedValue({ resultReference: 'results/p1/job-1' });
    screens.updateStatus.mockRejectedValue(new Error('screens collection unavailable'));

    runner.start();
    await expect(capturedProcessor!({ data: { conversionJobId: 'job-1' } })).resolves.toBeUndefined();

    expect(jobs.markCompleted).toHaveBeenCalledWith('job-1', { resultReference: 'results/p1/job-1' });
  });

  it('skips processing when the job could not be marked processing (already consumed/cancelled)', async () => {
    const runner = new ConversionWorkerRunner(
      enabledConfig as unknown as ConfigService,
      jobs as unknown as ConversionJobRepository,
      engine as unknown as ConversionEnginePort,
      screens as unknown as ScreenRepository,
    );
    jobs.markProcessing.mockResolvedValue(null);

    runner.start();
    await capturedProcessor!({ data: { conversionJobId: 'job-1' } });

    expect(engine.execute).not.toHaveBeenCalled();
    expect(jobs.markCompleted).not.toHaveBeenCalled();
    expect(jobs.markFailed).not.toHaveBeenCalled();
  });
});
