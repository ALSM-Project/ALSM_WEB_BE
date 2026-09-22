import { ServiceUnavailableException } from '@nestjs/common';
import { ExecuteAiValidationService } from '../src/modules/validation/application/execute-ai-validation.service';
import { AiValidationRuntimeGuard } from '../src/modules/validation/application/ai-validation-runtime.guard';
import { BuildValidationContextService } from '../src/modules/validation/application/build-validation-context.service';
import { PrepareAiValidationContextService } from '../src/modules/validation/application/prepare-ai-validation-context.service';
import { ReconcileValidationRunService } from '../src/modules/validation/application/reconcile-validation-run.service';
import { AiValidatorError } from '../src/modules/validation/domain/ai-validator.error';
import { AiValidatorPort } from '../src/modules/validation/domain/ai-validator.port';
import { ValidationExecutionError } from '../src/modules/validation/domain/validation-execution.error';
import { ValidationFindingRepository } from '../src/modules/validation/domain/validation-finding.repository';
import {
  ValidationFindingCategory,
  ValidationFindingSeverity,
  ValidationFindingSource,
  ValidationFindingStatus,
} from '../src/modules/validation/domain/validation-finding.types';
import { ValidationRunRepository } from '../src/modules/validation/domain/validation-run.repository';
import { ValidationRunStatus } from '../src/modules/validation/domain/validation-run.types';
import { ConversionType } from '../src/modules/projects/domain/project.types';

describe('ExecuteAiValidationService', () => {
  const buildContext = { execute: jest.fn() };
  const prepareContext = { execute: jest.fn() };
  const runtimeGuard = { assertAvailable: jest.fn() };
  const reconcileRun = { execute: jest.fn() };
  const validator = { getMetadata: jest.fn(), validate: jest.fn() };
  const validationRuns = {
    findById: jest.fn(),
    markResultsPersisted: jest.fn(),
  };
  const validationFindings = {
    countByRun: jest.fn(),
    upsertManyForRun: jest.fn(),
  };
  const service = new ExecuteAiValidationService(
    buildContext as unknown as BuildValidationContextService,
    prepareContext as unknown as PrepareAiValidationContextService,
    runtimeGuard as unknown as AiValidationRuntimeGuard,
    reconcileRun as unknown as ReconcileValidationRunService,
    validator as unknown as AiValidatorPort,
    validationRuns as unknown as ValidationRunRepository,
    validationFindings as unknown as ValidationFindingRepository,
  );
  const input = {
    validationRunId: 'run-1',
    organizationId: 'org-1',
    projectId: 'project-1',
    conversionJobId: 'job-1',
  };
  const run = {
    id: 'run-1',
    organizationId: 'org-1',
    projectId: 'project-1',
    conversionJobId: 'job-1',
    screenId: 'screen-1',
    status: ValidationRunStatus.PROCESSING,
    ruleValidationEnabled: false,
    aiValidationEnabled: true,
    findingCount: 0,
    provider: 'openai',
    model: 'test-model',
    promptVersion: 'semantic-cobol-java-v1',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const context = {
    organizationId: 'org-1',
    projectId: 'project-1',
    conversionJobId: 'job-1',
    screenId: 'screen-1',
    conversionType: ConversionType.COBOL_TO_JAVA,
    sourceFiles: [{ path: 'PROGRAM.cob', content: 'IDENTIFICATION DIVISION.' }],
    targetFiles: [{ path: 'Program.java', content: 'class Program {}' }],
  };
  const prepared = {
    input: {
      conversionJobId: 'job-1',
      sourceFiles: [{ path: 'PROGRAM.cob', content: '1 | IDENTIFICATION DIVISION.', lineCount: 1 }],
      targetFiles: [{ path: 'Program.java', content: '1 | class Program {}', lineCount: 1 }],
    },
    redactionCount: 1,
    selectedFileCount: 2,
    inputCharacterCount: 60,
  };
  const finding = {
    category: ValidationFindingCategory.LOGIC_MISMATCH,
    severity: ValidationFindingSeverity.HIGH,
    title: 'Branch differs',
    explanation: 'The generated branch differs from the source behavior.',
    sourceLocation: { file: 'PROGRAM.cob', startLine: 1, endLine: 1 },
    confidence: 0.8,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    validationRuns.findById.mockResolvedValue(run);
    validationFindings.countByRun.mockResolvedValue(0);
    buildContext.execute.mockResolvedValue(context);
    prepareContext.execute.mockReturnValue(prepared);
    runtimeGuard.assertAvailable.mockReturnValue({
      provider: 'openai',
      model: 'test-model',
      promptVersion: 'semantic-cobol-java-v1',
    });
    validator.validate.mockResolvedValue({ findings: [finding] });
    validationFindings.upsertManyForRun.mockResolvedValue(undefined);
    validationRuns.markResultsPersisted.mockResolvedValue(undefined);
    reconcileRun.execute.mockResolvedValue(1);
  });

  it('uses the existing run and persists deterministic application-owned fingerprints', async () => {
    await expect(service.execute(input)).resolves.toEqual({
      validationRunId: 'run-1',
      findingCount: 1,
    });

    expect(validationRuns.findById).toHaveBeenCalledWith('run-1', 'project-1', 'org-1');
    expect(validationFindings.upsertManyForRun).toHaveBeenCalledWith([
      expect.objectContaining({
        validationRunId: 'run-1',
        source: ValidationFindingSource.AI,
        status: ValidationFindingStatus.PENDING,
        fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    ]);
    expect(validationRuns.markResultsPersisted).toHaveBeenCalledWith(
      'run-1',
      'project-1',
      'org-1',
      expect.objectContaining({ findingCount: 1, resultsPersistedAt: expect.any(Date) }),
    );
    expect(reconcileRun.execute).toHaveBeenCalledWith(
      expect.objectContaining({ expectedFindingCount: 1, resultsPersistedAt: expect.any(Date) }),
    );
  });

  it('deduplicates normalized findings before idempotent persistence', async () => {
    validator.validate.mockResolvedValue({
      findings: [finding, { ...finding, title: '  BRANCH   DIFFERS ' }],
    });

    await service.execute(input);

    expect(validationFindings.upsertManyForRun.mock.calls[0][0]).toHaveLength(1);
  });

  it('marks zero-finding provider output as persisted before completion', async () => {
    validator.validate.mockResolvedValue({ findings: [] });
    reconcileRun.execute.mockResolvedValue(0);

    await expect(service.execute(input)).resolves.toEqual({
      validationRunId: 'run-1',
      findingCount: 0,
    });
    expect(validationFindings.upsertManyForRun).toHaveBeenCalledWith([]);
    expect(validationRuns.markResultsPersisted).toHaveBeenCalledWith(
      'run-1',
      'project-1',
      'org-1',
      expect.objectContaining({ findingCount: 0, resultsPersistedAt: expect.any(Date) }),
    );
  });

  it('reconciles an already-persisted result without another provider call', async () => {
    validationRuns.findById.mockResolvedValue({
      ...run,
      findingCount: 1,
      expectedFindingCount: 1,
      resultsPersistedAt: new Date(),
    });

    await service.execute(input);

    expect(buildContext.execute).not.toHaveBeenCalled();
    expect(validator.validate).not.toHaveBeenCalled();
    expect(reconcileRun.execute).toHaveBeenCalledTimes(1);
  });

  it('fails closed when findings exist without a result-persistence marker', async () => {
    validationFindings.countByRun.mockResolvedValue(1);

    await expect(service.execute(input)).rejects.toMatchObject({
      code: 'VALIDATION_RESULT_PERSISTENCE_AMBIGUOUS',
      retryable: false,
    });
    expect(validator.validate).not.toHaveBeenCalled();
  });

  it.each([
    ['AI_PROVIDER_TIMEOUT', true],
    ['AI_PROVIDER_RESPONSE_INVALID', false],
    ['AI_PROVIDER_AUTHENTICATION_FAILED', false],
  ])('classifies provider error %s with retryable=%s', async (code, retryable) => {
    validator.validate.mockRejectedValue(new AiValidatorError(code, 'safe provider failure'));

    await expect(service.execute(input)).rejects.toMatchObject({ code, retryable });
  });

  it('rejects execution when AI becomes disabled after queueing', async () => {
    runtimeGuard.assertAvailable.mockImplementation(() => {
      throw new ServiceUnavailableException({
        code: 'VALIDATION_AI_DISABLED',
        message: 'AI validation is disabled',
      });
    });

    await expect(service.execute(input)).rejects.toMatchObject({
      code: 'VALIDATION_AI_DISABLED',
      retryable: false,
    });
    expect(validator.validate).not.toHaveBeenCalled();
  });

  it('sanitizes an unknown persistence failure as retryable', async () => {
    validationFindings.upsertManyForRun.mockRejectedValue(new Error('mongodb://secret-host'));

    await expect(service.execute(input)).rejects.toEqual(
      new ValidationExecutionError(
        'VALIDATION_EXECUTION_TRANSIENT_FAILURE',
        'AI validation could not be completed',
        true,
      ),
    );
  });
});
