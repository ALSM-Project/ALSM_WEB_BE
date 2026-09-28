import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { BullMqConversionQueue, CONVERSION_QUEUE_NAME } from '../src/modules/conversions/infrastructure/bullmq-conversion.queue';
import { ConversionPriority } from '../src/modules/conversions/domain/conversion-job.types';

const add = jest.fn();
const close = jest.fn();
const on = jest.fn();

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({ add, close, on })),
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
  });

  it('enqueues a real BullMQ job for the conversion queue', async () => {
    const queue = new BullMqConversionQueue(config);

    await queue.enqueue('job-1', ConversionPriority.NORMAL);

    expect(Queue).toHaveBeenCalledWith(
      CONVERSION_QUEUE_NAME,
      expect.objectContaining({ connection: expect.objectContaining({ host: 'localhost', port: 6379 }) }),
    );
    expect(add).toHaveBeenCalledWith(
      'execute-conversion',
      { conversionJobId: 'job-1' },
      expect.objectContaining({ attempts: 3 }),
    );
  });

  // Regression test: a job that fails to reach BullMQ used to be silently dropped — the
  // Mongo record stayed QUEUED forever with nothing in Redis to ever pick it up, and the
  // caller had no way to know. Confirmed by reproduction against a real dev instance.
  it('propagates a real enqueue failure instead of swallowing it', async () => {
    add.mockRejectedValue(new Error('Redis connection lost'));
    const queue = new BullMqConversionQueue(config);

    await expect(queue.enqueue('job-1', ConversionPriority.NORMAL)).rejects.toThrow('Redis connection lost');
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
});
