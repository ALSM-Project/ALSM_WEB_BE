import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Worker } from 'bullmq';
import { ExecuteAiValidationService } from '../application/execute-ai-validation.service';
import { ValidationExecutionError } from '../domain/validation-execution.error';
import { ValidationQueueJob } from '../domain/validation-queue.port';
import {
  VALIDATION_RUN_REPOSITORY,
  ValidationRunRepository,
} from '../domain/validation-run.repository';
import { ValidationRunRecord, ValidationRunStatus } from '../domain/validation-run.types';
import { VALIDATION_QUEUE_NAME } from './bullmq-validation.queue';

@Injectable()
export class ValidationWorkerRunner implements OnModuleDestroy {
  private readonly logger = new Logger(ValidationWorkerRunner.name);
  private worker?: Worker<ValidationQueueJob>;

  constructor(
    private readonly config: ConfigService,
    @Inject(VALIDATION_RUN_REPOSITORY)
    private readonly validationRuns: ValidationRunRepository,
    private readonly executeAiValidation: ExecuteAiValidationService,
  ) {}

  start(): void {
    if (!this.config.get<boolean>('VALIDATION_WORKER_ENABLED')) {
      this.logger.warn('AI validation worker is disabled.');
      return;
    }
    if (this.worker) return;

    this.worker = new Worker<ValidationQueueJob>(
      VALIDATION_QUEUE_NAME,
      async (job) => this.process(job),
      {
        connection: {
          host: this.config.getOrThrow<string>('REDIS_HOST'),
          port: this.config.getOrThrow<number>('REDIS_PORT'),
          password: this.config.get<string>('REDIS_PASSWORD') || undefined,
        },
        concurrency: this.config.getOrThrow<number>('VALIDATION_WORKER_CONCURRENCY'),
      },
    );
    this.logger.log('AI validation worker started.');
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }

  private async process(job: Job<ValidationQueueJob>): Promise<void> {
    const payload = job.data;
    let run = await this.validationRuns.findById(
      payload.validationRunId,
      payload.projectId,
      payload.organizationId,
    );
    if (!run) {
      this.logger.warn(`Validation run ${payload.validationRunId} was not found for queued work.`);
      return;
    }
    if (run.conversionJobId !== payload.conversionJobId) {
      await this.failRun(
        run,
        'VALIDATION_JOB_PAYLOAD_MISMATCH',
        'Validation job metadata is invalid',
      );
      return;
    }
    if (this.isTerminal(run)) return;

    if (run.status === ValidationRunStatus.QUEUED) {
      const claimed = await this.validationRuns.markProcessing(
        run.id,
        run.projectId,
        run.organizationId,
      );
      if (!claimed) {
        run = await this.validationRuns.findById(run.id, run.projectId, run.organizationId);
        if (!run || this.isTerminal(run)) return;
        if (run.status !== ValidationRunStatus.PROCESSING) return;
      } else {
        run = claimed;
      }
    }
    if (run.status !== ValidationRunStatus.PROCESSING) return;

    try {
      await this.executeAiValidation.execute(payload);
    } catch (error) {
      const failure = this.classify(error);
      const configuredAttempts = this.config.getOrThrow<number>('VALIDATION_JOB_ATTEMPTS');
      const maximumAttempts =
        typeof job.opts.attempts === 'number' ? job.opts.attempts : configuredAttempts;
      const isFinalAttempt = job.attemptsMade + 1 >= maximumAttempts;

      if (!failure.retryable || isFinalAttempt) {
        await this.failRun(run, failure.code, failure.message);
        if (!failure.retryable) return;
      }
      throw failure;
    }
  }

  private isTerminal(run: ValidationRunRecord): boolean {
    return (
      run.status === ValidationRunStatus.COMPLETED || run.status === ValidationRunStatus.FAILED
    );
  }

  private async failRun(run: ValidationRunRecord, code: string, message: string): Promise<void> {
    await this.validationRuns.markFailed(run.id, run.projectId, run.organizationId, {
      failureCode: code,
      failureMessage: message,
      redactionCount: run.redactionCount,
      selectedFileCount: run.selectedFileCount,
      inputCharacterCount: run.inputCharacterCount,
    });
  }

  private classify(error: unknown): ValidationExecutionError {
    if (error instanceof ValidationExecutionError) return error;
    return new ValidationExecutionError(
      'VALIDATION_EXECUTION_TRANSIENT_FAILURE',
      'AI validation could not be completed',
      true,
    );
  }
}
