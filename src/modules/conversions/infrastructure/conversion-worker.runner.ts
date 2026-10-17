import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UnrecoverableError, Worker } from 'bullmq';
import { randomUUID } from 'node:crypto';
import {
  CONVERSION_ENGINE,
  CONVERSION_JOB_REPOSITORY,
  ConversionEnginePort,
  ConversionJobRepository,
  ConversionJobStatus,
} from '../domain/conversion-job.types';
import { CONVERSION_QUEUE_NAME } from './bullmq-conversion.queue';
import {
  SCREEN_REPOSITORY,
  ScreenRepository,
  ScreenStatus,
} from '../../screens/domain/screen.types';
import { CopybookDependencyBlockedError } from '../domain/copybook-dependency-blocked.error';

@Injectable()
export class ConversionWorkerRunner implements OnModuleDestroy {
  private readonly logger = new Logger(ConversionWorkerRunner.name);
  private worker?: Worker<{ conversionJobId: string; executionGeneration?: number }>;

  constructor(
    private readonly config: ConfigService,
    @Inject(CONVERSION_JOB_REPOSITORY) private readonly jobs: ConversionJobRepository,
    @Inject(CONVERSION_ENGINE) private readonly engine: ConversionEnginePort,
    @Inject(SCREEN_REPOSITORY) private readonly screens: ScreenRepository,
  ) {}

  /** Best-effort: a screen's status is a UI convenience derived from its latest job, never the source of truth (the job record is) — a failure here must never fail the job itself. */
  private async syncScreenStatus(
    job: { screenId?: string; organizationId: string },
    status: ScreenStatus,
  ): Promise<void> {
    if (!job.screenId) return;
    try {
      await this.screens.updateStatus(job.screenId, job.organizationId, status);
    } catch (error) {
      this.logger.warn(
        `Failed to sync screen ${job.screenId} status to ${status}: ${String(error)}`,
      );
    }
  }

  start(): void {
    if (!this.config.get<boolean>('CONVERSION_WORKER_ENABLED')) {
      this.logger.warn(
        'Conversion worker is disabled. Set CONVERSION_WORKER_ENABLED=true only after configuring an external engine adapter.',
      );
      return;
    }
    this.worker = new Worker(
      CONVERSION_QUEUE_NAME,
      async (queueJob) => {
        const token = randomUUID();
        const leaseDurationMs = 45000;
        const job = await this.jobs.markProcessing(
          queueJob.data.conversionJobId,
          token,
          new Date(Date.now() + leaseDurationMs),
          queueJob.data.executionGeneration ?? 0,
        );
        if (!job) {
          const existing = await this.jobs.findByIdAnyOrganization(queueJob.data.conversionJobId);
          if (existing?.status === ConversionJobStatus.PROCESSING) {
            throw new Error('Conversion job has an active processing lease');
          }
          return;
        }
        let leaseLost = false;
        const heartbeat = setInterval(() => {
          void this.jobs
            .renewProcessingLease(job.id, token, new Date(Date.now() + leaseDurationMs))
            .then((renewed) => {
              if (!renewed) leaseLost = true;
            })
            .catch(() => {
              leaseLost = true;
            });
        }, 10000);
        heartbeat.unref();
        await this.syncScreenStatus(job, ScreenStatus.PROCESSING);
        try {
          const output = await this.engine.execute({
            conversionJobId: job.id,
            organizationId: job.organizationId,
            projectId: job.projectId,
            screenId: job.screenId,
            inputReference: job.inputReference,
            conversionType: job.conversionType,
          });
          if (leaseLost) throw new Error('Conversion processing lease was lost');
          const completed = await this.jobs.markCompleted(job.id, output, undefined, token);
          if (!completed) throw new Error('Conversion processing lease was lost');
          await this.syncScreenStatus(job, ScreenStatus.COMPLETED);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'External conversion engine failed';
          const code =
            error instanceof CopybookDependencyBlockedError
              ? 'COPYBOOK_DEPENDENCY_BLOCKED'
              : 'CONVERSION_ENGINE_UNAVAILABLE';
          const attemptsAllowed = queueJob.opts.attempts ?? 1;
          const isFinalAttempt =
            error instanceof UnrecoverableError || queueJob.attemptsMade + 1 >= attemptsAllowed;
          if (isFinalAttempt) {
            await this.jobs.markFailed(job.id, code, message, token);
            if (!leaseLost) await this.syncScreenStatus(job, ScreenStatus.FAILED);
          } else {
            await this.jobs.releaseProcessingForRetry(job.id, token);
          }
          throw error;
        } finally {
          clearInterval(heartbeat);
        }
      },
      {
        // Mongo leases expire before BullMQ recovers an abandoned lock.
        lockDuration: 60000,
        connection: {
          host: this.config.getOrThrow('REDIS_HOST'),
          port: this.config.getOrThrow<number>('REDIS_PORT'),
          password: this.config.get<string>('REDIS_PASSWORD') || undefined,
        },
      },
    );
    this.worker.on('error', (error) =>
      this.logger.error(`Conversion worker error: ${String(error)}`),
    );
    this.worker.on('failed', (queueJob) => {
      if (!queueJob) return;
      // BullMQ may exhaust stalled recovery without entering the processor again.
      // Only an expired lease for this exact execution may be failed by that event.
      void queueJob
        .isFailed()
        .then(async (terminal) => {
          if (terminal)
            await this.jobs.markAbandonedFailed(
              queueJob.data.conversionJobId,
              queueJob.data.executionGeneration ?? 0,
            );
        })
        .catch((error: unknown) =>
          this.logger.error(`Failed to reconcile abandoned conversion: ${String(error)}`),
        );
    });
    this.logger.log('Conversion worker started.');
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
