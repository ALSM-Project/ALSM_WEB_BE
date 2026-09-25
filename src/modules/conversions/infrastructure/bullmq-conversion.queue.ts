import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { ConversionPriority, ConversionQueuePort } from '../domain/conversion-job.types';

export const CONVERSION_QUEUE_NAME = 'conversion';
export const BULLMQ_PRIORITY: Record<ConversionPriority, number> = {
  [ConversionPriority.HIGH]: 1,
  [ConversionPriority.NORMAL]: 5,
  [ConversionPriority.LOW]: 10,
};

@Injectable()
export class BullMqConversionQueue implements ConversionQueuePort, OnModuleDestroy {
  private readonly logger = new Logger(BullMqConversionQueue.name);
  private queue?: Queue<{ conversionJobId: string }>;

  constructor(private readonly config: ConfigService) {
    if (this.config.get('CONVERSION_WORKER_ENABLED') === 'true') {
      this.queue = new Queue(CONVERSION_QUEUE_NAME, {
        connection: {
          host: config.getOrThrow('REDIS_HOST'),
          port: config.getOrThrow<number>('REDIS_PORT'),
          password: config.get<string>('REDIS_PASSWORD') || undefined,
          maxRetriesPerRequest: null,
          enableOfflineQueue: false,
        },
      });
      this.queue.on('error', (error) => {
        this.logger.warn(`Redis connection error: ${String(error)}`);
      });
    }
  }

  // A conversion job record is only useful once it's actually reachable by a worker — a job
  // stuck in Mongo as QUEUED with no matching BullMQ entry never gets processed and never
  // surfaces as an error, it just hangs forever. Swallowing this error used to do exactly
  // that (confirmed by reproduction: jobs sitting in Mongo as QUEUED with zero trace in
  // Redis). Let it propagate so the caller can fail the request instead.
  async enqueue(conversionJobId: string, priority: ConversionPriority): Promise<void> {
    if (!this.queue || this.config.get('CONVERSION_WORKER_ENABLED') !== 'true') {
      throw new Error('Conversion queue is not configured (CONVERSION_WORKER_ENABLED is not "true")');
    }
    await this.queue.add(
      'execute-conversion',
      { conversionJobId },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        priority: BULLMQ_PRIORITY[priority],
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) {
      try {
        await this.queue.close();
      } catch {
        // Ignore shutdown error if Redis is down
      }
    }
  }
}
