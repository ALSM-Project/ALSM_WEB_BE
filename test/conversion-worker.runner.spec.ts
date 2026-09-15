import { ConfigService } from '@nestjs/config';
import { ConversionWorkerRunner } from '../src/modules/conversions/infrastructure/conversion-worker.runner';
import {
  ConversionEnginePort,
  ConversionJobRepository,
} from '../src/modules/conversions/domain/conversion-job.types';

type Processor = (job: { data: { conversionJobId: string } }) => Promise<void>;
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
    );

    runner.start();

    expect(capturedProcessor).toBeUndefined();
  });

  it('persists resultReference/toolVersion via markCompleted when the engine succeeds', async () => {
    const runner = new ConversionWorkerRunner(
      enabledConfig as unknown as ConfigService,
      jobs as unknown as ConversionJobRepository,
      engine as unknown as ConversionEnginePort,
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
  });

  it('marks the job failed and rethrows when the engine rejects', async () => {
    const runner = new ConversionWorkerRunner(
      enabledConfig as unknown as ConfigService,
      jobs as unknown as ConversionJobRepository,
      engine as unknown as ConversionEnginePort,
    );
    jobs.markProcessing.mockResolvedValue({
      id: 'job-1',
      organizationId: 'org-1',
      projectId: 'p1',
      conversionType: 'BMS_DSPF_TO_FRONTEND',
    });
    engine.execute.mockRejectedValue(new Error('tool crashed'));

    runner.start();
    await expect(capturedProcessor!({ data: { conversionJobId: 'job-1' } })).rejects.toThrow('tool crashed');

    expect(jobs.markFailed).toHaveBeenCalledWith('job-1', 'CONVERSION_ENGINE_UNAVAILABLE', 'tool crashed');
    expect(jobs.markCompleted).not.toHaveBeenCalled();
  });

  it('skips processing when the job could not be marked processing (already consumed/cancelled)', async () => {
    const runner = new ConversionWorkerRunner(
      enabledConfig as unknown as ConfigService,
      jobs as unknown as ConversionJobRepository,
      engine as unknown as ConversionEnginePort,
    );
    jobs.markProcessing.mockResolvedValue(null);

    runner.start();
    await capturedProcessor!({ data: { conversionJobId: 'job-1' } });

    expect(engine.execute).not.toHaveBeenCalled();
    expect(jobs.markCompleted).not.toHaveBeenCalled();
    expect(jobs.markFailed).not.toHaveBeenCalled();
  });
});
