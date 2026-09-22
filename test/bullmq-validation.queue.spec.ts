import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import {
  BullMqValidationQueue,
  VALIDATION_JOB_NAME,
  VALIDATION_QUEUE_NAME,
} from '../src/modules/validation/infrastructure/bullmq-validation.queue';

const add = jest.fn();
const close = jest.fn();

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({ add, close })),
}));

describe('BullMqValidationQueue', () => {
  const values: Record<string, unknown> = {
    REDIS_HOST: 'localhost',
    REDIS_PORT: 6379,
    REDIS_PASSWORD: '',
    VALIDATION_JOB_ATTEMPTS: 2,
    VALIDATION_JOB_BACKOFF_MS: 5_000,
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

  it('uses a dedicated queue and validationRunId as the duplicate-safe job id', async () => {
    const queue = new BullMqValidationQueue(config);
    const job = {
      validationRunId: 'run-1',
      organizationId: 'org-1',
      projectId: 'project-1',
      conversionJobId: 'conversion-1',
    };

    await queue.enqueue(job);

    expect(Queue).toHaveBeenCalledWith(
      VALIDATION_QUEUE_NAME,
      expect.objectContaining({
        connection: expect.objectContaining({ host: 'localhost', port: 6379 }),
      }),
    );
    expect(add).toHaveBeenCalledWith(VALIDATION_JOB_NAME, job, {
      jobId: 'run-1',
      attempts: 2,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: 1_000,
      removeOnFail: 5_000,
    });
  });

  it('places IDs only in Redis job data', async () => {
    const queue = new BullMqValidationQueue(config);

    await queue.enqueue({
      validationRunId: 'run-1',
      organizationId: 'org-1',
      projectId: 'project-1',
      conversionJobId: 'conversion-1',
    });

    const payload = add.mock.calls[0][1] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual([
      'conversionJobId',
      'organizationId',
      'projectId',
      'validationRunId',
    ]);
    expect(JSON.stringify(payload)).not.toMatch(/source|java|prompt|api.?key|authorization/i);
  });

  it('closes its BullMQ connection during shutdown', async () => {
    const queue = new BullMqValidationQueue(config);

    await queue.onModuleDestroy();

    expect(close).toHaveBeenCalledTimes(1);
  });
});
