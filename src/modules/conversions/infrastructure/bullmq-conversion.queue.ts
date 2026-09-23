import { Injectable, OnModuleDestroy } from '@nestjs/common';
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
  private queue?: Queue<{ conversionJobId: string }>;

  constructor(private readonly config: ConfigService) {
    if (this.config.get('CONVERSION_WORKER_ENABLED') === 'true') {
      try {
        this.queue = new Queue(CONVERSION_QUEUE_NAME, {
          connection: {
            host: config.getOrThrow('REDIS_HOST'),
            port: config.getOrThrow<number>('REDIS_PORT'),
            password: config.get<string>('REDIS_PASSWORD') || undefined,
            maxRetriesPerRequest: null,
            enableOfflineQueue: false,
          },
        });
        this.queue.on('error', () => {});
        (this.queue as any).client?.on('error', () => {});
      } catch {
        // Suppress Redis queue initialization error if Redis is down
      }
    }
  }

  async enqueue(conversionJobId: string, priority: ConversionPriority): Promise<void> {
    if (!this.queue || this.config.get('CONVERSION_WORKER_ENABLED') !== 'true') {
      return;
    }
    try {
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
    } catch {
      // Fallback if Redis is down
    }
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
