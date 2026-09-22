import { ConfigService } from '@nestjs/config';
import { ExecuteAiValidationService } from '../src/modules/validation/application/execute-ai-validation.service';
import { ValidationExecutionError } from '../src/modules/validation/domain/validation-execution.error';
import { ValidationRunRepository } from '../src/modules/validation/domain/validation-run.repository';
import { ValidationRunStatus } from '../src/modules/validation/domain/validation-run.types';
import { ValidationWorkerRunner } from '../src/modules/validation/infrastructure/validation-worker.runner';
import { VALIDATION_QUEUE_NAME } from '../src/modules/validation/infrastructure/bullmq-validation.queue';

type QueueJob = {
  data: {
    validationRunId: string;
    organizationId: string;
    projectId: string;
    conversionJobId: string;
  };
  attemptsMade: number;
  opts: { attempts?: number };
};
type Processor = (job: QueueJob) => Promise<void>;
let capturedProcessor: Processor | undefined;
let capturedOptions: Record<string, unknown> | undefined;
const close = jest.fn();

jest.mock('bullmq', () => ({
  Worker: jest
    .fn()
    .mockImplementation((_name: string, processor: Processor, options: Record<string, unknown>) => {
      capturedProcessor = processor;
      capturedOptions = options;
      return { close };
    }),
}));

describe('ValidationWorkerRunner', () => {
  const validationRuns = {
    findById: jest.fn(),
    markProcessing: jest.fn(),
    markFailed: jest.fn(),
  };
  const executeAiValidation = { execute: jest.fn() };
  const values: Record<string, unknown> = {
    VALIDATION_WORKER_ENABLED: true,
    VALIDATION_WORKER_CONCURRENCY: 2,
    VALIDATION_JOB_ATTEMPTS: 2,
    REDIS_HOST: 'localhost',
    REDIS_PORT: 6379,
    REDIS_PASSWORD: '',
  };
  const config = {
    get: jest.fn((key: string) => values[key]),
    getOrThrow: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
  const queuedRun = {
    id: 'run-1',
    organizationId: 'org-1',
    projectId: 'project-1',
    conversionJobId: 'conversion-1',
    status: ValidationRunStatus.QUEUED,
    ruleValidationEnabled: false,
    aiValidationEnabled: true,
    findingCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const processingRun = { ...queuedRun, status: ValidationRunStatus.PROCESSING };
  const job: QueueJob = {
    data: {
      validationRunId: 'run-1',
      organizationId: 'org-1',
      projectId: 'project-1',
      conversionJobId: 'conversion-1',
    },
    attemptsMade: 0,
    opts: { attempts: 2 },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    capturedProcessor = undefined;
    capturedOptions = undefined;
    validationRuns.findById.mockResolvedValue(queuedRun);
    validationRuns.markProcessing.mockResolvedValue(processingRun);
    validationRuns.markFailed.mockResolvedValue(undefined);
    executeAiValidation.execute.mockResolvedValue({ validationRunId: 'run-1', findingCount: 0 });
    close.mockResolvedValue(undefined);
  });

  function start(): ValidationWorkerRunner {
    const runner = new ValidationWorkerRunner(
      config,
      validationRuns as unknown as ValidationRunRepository,
      executeAiValidation as unknown as ExecuteAiValidationService,
    );
    runner.start();
    return runner;
  }

  it('does not create a worker when validation processing is disabled', () => {
    const disabledConfig = {
      get: jest.fn((key: string) => key === 'VALIDATION_WORKER_ENABLED' && false),
      getOrThrow: jest.fn(),
    } as unknown as ConfigService;
    const runner = new ValidationWorkerRunner(
      disabledConfig,
      validationRuns as unknown as ValidationRunRepository,
      executeAiValidation as unknown as ExecuteAiValidationService,
    );

    runner.start();

    expect(capturedProcessor).toBeUndefined();
  });

  it('starts one dedicated worker with configured concurrency', () => {
    const runner = start();
    runner.start();

    expect(capturedProcessor).toBeDefined();
    expect(capturedOptions).toEqual(
      expect.objectContaining({ concurrency: 2, connection: expect.any(Object) }),
    );
    const { Worker } = jest.requireMock('bullmq') as { Worker: jest.Mock };
    expect(Worker).toHaveBeenCalledTimes(1);
    expect(Worker).toHaveBeenCalledWith(
      VALIDATION_QUEUE_NAME,
      expect.any(Function),
      expect.any(Object),
    );
  });

  it('claims QUEUED and executes the existing run', async () => {
    start();

    await capturedProcessor!(job);

    expect(validationRuns.findById).toHaveBeenCalledWith('run-1', 'project-1', 'org-1');
    expect(validationRuns.markProcessing).toHaveBeenCalledWith('run-1', 'project-1', 'org-1');
    expect(executeAiValidation.execute).toHaveBeenCalledWith(job.data);
  });

  it('continues a PROCESSING run on retry without creating another run', async () => {
    validationRuns.findById.mockResolvedValue(processingRun);
    start();

    await capturedProcessor!({ ...job, attemptsMade: 1 });

    expect(validationRuns.markProcessing).not.toHaveBeenCalled();
    expect(executeAiValidation.execute).toHaveBeenCalledWith(job.data);
  });

  it.each([ValidationRunStatus.COMPLETED, ValidationRunStatus.FAILED])(
    'treats a duplicate %s job as a safe no-op',
    async (status) => {
      validationRuns.findById.mockResolvedValue({ ...processingRun, status });
      start();

      await capturedProcessor!(job);

      expect(executeAiValidation.execute).not.toHaveBeenCalled();
      expect(validationRuns.markFailed).not.toHaveBeenCalled();
    },
  );

  it('leaves a retryable first failure PROCESSING and asks BullMQ to retry', async () => {
    executeAiValidation.execute.mockRejectedValue(
      new ValidationExecutionError('AI_PROVIDER_TIMEOUT', 'AI provider request timed out', true),
    );
    start();

    await expect(capturedProcessor!(job)).rejects.toMatchObject({ code: 'AI_PROVIDER_TIMEOUT' });

    expect(validationRuns.markFailed).not.toHaveBeenCalled();
  });

  it('classifies an initial database failure as retryable', async () => {
    validationRuns.findById.mockRejectedValue(new Error('temporary database failure'));
    start();

    await expect(capturedProcessor!(job)).rejects.toMatchObject({
      code: 'VALIDATION_EXECUTION_TRANSIENT_FAILURE',
      retryable: true,
    });
    expect(validationRuns.markFailed).not.toHaveBeenCalled();
  });

  it('reloads and fails the persisted run after a final initial database failure', async () => {
    validationRuns.findById
      .mockRejectedValueOnce(new Error('temporary database failure'))
      .mockResolvedValueOnce(processingRun);
    start();

    await expect(capturedProcessor!({ ...job, attemptsMade: 1 })).rejects.toMatchObject({
      code: 'VALIDATION_EXECUTION_TRANSIENT_FAILURE',
    });
    expect(validationRuns.markFailed).toHaveBeenCalledWith(
      'run-1',
      'project-1',
      'org-1',
      expect.objectContaining({ failureCode: 'VALIDATION_EXECUTION_TRANSIENT_FAILURE' }),
    );
  });

  it('marks the same run FAILED after the final retryable attempt', async () => {
    executeAiValidation.execute.mockRejectedValue(
      new ValidationExecutionError('AI_PROVIDER_TIMEOUT', 'AI provider request timed out', true),
    );
    start();

    await expect(capturedProcessor!({ ...job, attemptsMade: 1 })).rejects.toMatchObject({
      code: 'AI_PROVIDER_TIMEOUT',
    });

    expect(validationRuns.markFailed).toHaveBeenCalledWith('run-1', 'project-1', 'org-1', {
      failureCode: 'AI_PROVIDER_TIMEOUT',
      failureMessage: 'AI provider request timed out',
      redactionCount: undefined,
      selectedFileCount: undefined,
      inputCharacterCount: undefined,
    });
  });

  it('marks a non-retryable disabled-provider failure without another BullMQ attempt', async () => {
    executeAiValidation.execute.mockRejectedValue(
      new ValidationExecutionError('VALIDATION_AI_DISABLED', 'AI validation is disabled', false),
    );
    start();

    await expect(capturedProcessor!(job)).resolves.toBeUndefined();

    expect(validationRuns.markFailed).toHaveBeenCalledWith(
      'run-1',
      'project-1',
      'org-1',
      expect.objectContaining({ failureCode: 'VALIDATION_AI_DISABLED' }),
    );
  });

  it('rejects mismatched persisted conversion metadata without executing AI', async () => {
    validationRuns.findById.mockResolvedValue({
      ...queuedRun,
      conversionJobId: 'other-conversion',
    });
    start();

    await capturedProcessor!(job);

    expect(executeAiValidation.execute).not.toHaveBeenCalled();
    expect(validationRuns.markFailed).toHaveBeenCalledWith(
      'run-1',
      'project-1',
      'org-1',
      expect.objectContaining({ failureCode: 'VALIDATION_JOB_PAYLOAD_MISMATCH' }),
    );
  });

  it('closes the worker during application shutdown', async () => {
    const runner = start();

    await runner.onModuleDestroy();

    expect(close).toHaveBeenCalledTimes(1);
  });
});
