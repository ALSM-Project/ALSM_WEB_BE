import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import {
  BullMqConversionQueue,
  CONVERSION_QUEUE_NAME,
  CONVERSION_QUEUE_READY_TIMEOUT_MS,
} from '../src/modules/conversions/infrastructure/bullmq-conversion.queue';
import { ConversionPriority } from '../src/modules/conversions/domain/conversion-job.types';

const add = jest.fn();
const close = jest.fn();
const on = jest.fn();
const getJob = jest.fn();
const waitUntilReady = jest.fn();

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({ add, close, on, getJob, waitUntilReady })),
}));

describe('BullMqConversionQueue', () => {
  // CONVERSION_WORKER_ENABLED is Joi.boolean() in environment.validation.ts, so
  // ConfigService really returns a boolean here, not the 'true' string from .env. Mocking
  // it as a string (as this test used to) hides exactly the bug this suite exists to catch:
  // a strict `=== 'true'` check is always false against a real boolean, which meant
  // this.queue was never initialized in production despite .env being configured correctly.
  const values: Record<string, unknown> = {
    CONVERSION_WORKER_ENABLED: true,
    REDIS_HOST: 'localhost',
    REDIS_PORT: 6379,
    REDIS_PASSWORD: '',
  };
  const config = {
    get: jest.fn((key: string) => values[key]),
    getOrThrow: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;

  beforeEach(() => {
    jest.clearAllMocks();
    add.mockResolvedValue(undefined);
    close.mockResolvedValue(undefined);
    waitUntilReady.mockResolvedValue(undefined);
  });

  it('enqueues a real BullMQ job for the conversion queue', async () => {
    const queue = new BullMqConversionQueue(config);

    await queue.enqueue('job-1', ConversionPriority.NORMAL);

    expect(Queue).toHaveBeenCalledWith(
      CONVERSION_QUEUE_NAME,
      expect.objectContaining({
        connection: expect.objectContaining({ host: 'localhost', port: 6379 }),
      }),
    );
    expect(add).toHaveBeenCalledWith(
      'execute-conversion',
      { conversionJobId: 'job-1', executionGeneration: 0 },
      expect.objectContaining({ attempts: 3, jobId: 'job-1-0' }),
    );
  });

  // Regression test: a job that fails to reach BullMQ used to be silently dropped — the
  // Mongo record stayed QUEUED forever with nothing in Redis to ever pick it up, and the
  // caller had no way to know. Confirmed by reproduction against a real dev instance.
  it('propagates a real enqueue failure instead of swallowing it', async () => {
    add.mockRejectedValue(new Error('Redis connection lost'));
    const queue = new BullMqConversionQueue(config);

    await expect(queue.enqueue('job-1', ConversionPriority.NORMAL)).rejects.toThrow(
      'Redis connection lost',
    );
  });

  it('throws instead of silently no-op-ing when the worker/queue is disabled', async () => {
    const disabledConfig = {
      get: jest.fn((key: string) => (key === 'CONVERSION_WORKER_ENABLED' ? false : values[key])),
      getOrThrow: jest.fn((key: string) => values[key]),
    } as unknown as ConfigService;
    const queue = new BullMqConversionQueue(disabledConfig);

    await expect(queue.enqueue('job-1', ConversionPriority.NORMAL)).rejects.toThrow();
    expect(add).not.toHaveBeenCalled();
  });

  it('closes its BullMQ connection during shutdown', async () => {
    const queue = new BullMqConversionQueue(config);

    await queue.onModuleDestroy();

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('bounds cold readiness and never enqueues a timed-out request after Redis becomes ready', async () => {
    jest.useFakeTimers();
    let ready!: () => void;
    waitUntilReady.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          ready = resolve;
        }),
    );
    const queue = new BullMqConversionQueue(config);
    try {
      const rejected = expect(queue.enqueue('job-1', ConversionPriority.NORMAL)).rejects.toThrow(
        'Redis readiness timed out',
      );
      await jest.advanceTimersByTimeAsync(CONVERSION_QUEUE_READY_TIMEOUT_MS);
      await rejected;
      ready();
      await Promise.resolve();
      expect(add).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
      await queue.enqueue('job-1', ConversionPriority.NORMAL, 1);
      expect(add).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('distinguishes missing, terminal and pending delivery without hiding Redis errors', async () => {
    const queue = new BullMqConversionQueue(config);
    getJob.mockResolvedValueOnce(undefined);
    await expect(queue.deliveryState('job-1', 2)).resolves.toBe('missing');
    expect(getJob).toHaveBeenCalledWith('job-1-2');
    for (const state of ['completed', 'failed', 'active', 'delayed', 'prioritized', 'unknown']) {
      getJob.mockResolvedValueOnce({ getState: async () => state });
      await expect(queue.deliveryState('job-1', 2)).resolves.toBe(
        state === 'unknown'
          ? 'missing'
          : ['completed', 'failed'].includes(state)
            ? 'terminal'
            : 'pending',
      );
    }
    getJob.mockRejectedValueOnce(new Error('Redis inspection unavailable'));
    await expect(queue.deliveryState('job-1', 2)).rejects.toThrow('Redis inspection unavailable');
  });
});
