import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { ValidationQueueJob, ValidationQueuePort } from '../domain/validation-queue.port';

export const VALIDATION_QUEUE_NAME = 'ai-validation';
export const VALIDATION_JOB_NAME = 'execute-ai-validation';

@Injectable()
export class BullMqValidationQueue implements ValidationQueuePort, OnModuleDestroy {
  private readonly queue: Queue<ValidationQueueJob>;

  constructor(private readonly config: ConfigService) {
    this.queue = new Queue(VALIDATION_QUEUE_NAME, {
      connection: {
        host: this.config.getOrThrow<string>('REDIS_HOST'),
        port: this.config.getOrThrow<number>('REDIS_PORT'),
        password: this.config.get<string>('REDIS_PASSWORD') || undefined,
      },
    });
  }

  async enqueue(job: ValidationQueueJob): Promise<void> {
    await this.queue.add(VALIDATION_JOB_NAME, job, {
      jobId: job.validationRunId,
      attempts: this.config.getOrThrow<number>('VALIDATION_JOB_ATTEMPTS'),
      backoff: {
        type: 'exponential',
        delay: this.config.getOrThrow<number>('VALIDATION_JOB_BACKOFF_MS'),
      },
      removeOnComplete: 1_000,
      removeOnFail: 5_000,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
