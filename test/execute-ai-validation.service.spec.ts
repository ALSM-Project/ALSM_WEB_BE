import { BadRequestException } from '@nestjs/common';
import { ExecuteAiValidationService } from '../src/modules/validation/application/execute-ai-validation.service';
import { BuildValidationContextService } from '../src/modules/validation/application/build-validation-context.service';
import { PrepareAiValidationContextService } from '../src/modules/validation/application/prepare-ai-validation-context.service';
import { AiValidatorError } from '../src/modules/validation/domain/ai-validator.error';
import { AiValidatorPort } from '../src/modules/validation/domain/ai-validator.port';
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
  const validator = { getMetadata: jest.fn(), validate: jest.fn() };
  const validationRuns = { create: jest.fn(), markCompleted: jest.fn(), markFailed: jest.fn() };
  const validationFindings = { createMany: jest.fn() };
  const service = new ExecuteAiValidationService(
    buildContext as unknown as BuildValidationContextService,
    prepareContext as unknown as PrepareAiValidationContextService,
    validator as unknown as AiValidatorPort,
    validationRuns as unknown as ValidationRunRepository,
    validationFindings as unknown as ValidationFindingRepository,
  );
  const input = {
    organizationId: 'org-1',
    projectId: 'project-1',
    conversionJobId: 'job-1',
  };
  const context = {
    ...input,
    screenId: 'screen-1',
    conversionType: ConversionType.COBOL_TO_JAVA,
    sourceFiles: [{ path: 'PROGRAM.cob', content: 'IDENTIFICATION DIVISION.' }],
    targetFiles: [{ path: 'Program.java', content: 'class Program {}' }],
  };
  const prepared = {
    input: {
      conversionJobId: 'job-1',
      sourceFiles: [
        { path: 'PROGRAM.cob', content: '1 | IDENTIFICATION DIVISION.', lineCount: 1 },
      ],
      targetFiles: [
        { path: 'Program.java', content: '1 | class Program {}', lineCount: 1 },
      ],
    },
    redactionCount: 1,
    selectedFileCount: 2,
    inputCharacterCount: 60,
  };
  const run = {
    id: 'run-1',
    ...input,
    status: ValidationRunStatus.PROCESSING,
    ruleValidationEnabled: false,
    aiValidationEnabled: true,
    findingCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const finding = {
    category: ValidationFindingCategory.LOGIC_MISMATCH,
    severity: ValidationFindingSeverity.HIGH,
    title: 'Branch differs',
    explanation: 'The generated branch differs from the source behavior.',
    confidence: 0.8,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    buildContext.execute.mockResolvedValue(context);
    prepareContext.execute.mockReturnValue(prepared);
    validator.getMetadata.mockReturnValue({
      provider: 'openai',
      model: 'test-model',
      promptVersion: 'semantic-cobol-java-v1',
    });
    validator.validate.mockResolvedValue({ findings: [finding] });
    validationRuns.create.mockResolvedValue(run);
    validationRuns.markCompleted.mockResolvedValue(undefined);
    validationRuns.markFailed.mockResolvedValue(undefined);
    validationFindings.createMany.mockResolvedValue([]);
  });

  it('prepares provider input before validation and persists application-owned finding fields', async () => {
    await expect(service.execute(input)).resolves.toEqual({
      validationRunId: 'run-1',
      findingCount: 1,
    });

    expect(validationRuns.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: ValidationRunStatus.PROCESSING,
        ruleValidationEnabled: false,
        aiValidationEnabled: true,
        provider: 'openai',
        model: 'test-model',
        promptVersion: 'semantic-cobol-java-v1',
      }),
    );
    expect(prepareContext.execute).toHaveBeenCalledWith(context);
    expect(validator.validate).toHaveBeenCalledWith(prepared.input);
    expect(prepareContext.execute.mock.invocationCallOrder[0]).toBeLessThan(
      validator.validate.mock.invocationCallOrder[0],
    );
    expect(validationFindings.createMany).toHaveBeenCalledWith([
      expect.objectContaining({
        organizationId: 'org-1',
        projectId: 'project-1',
        conversionJobId: 'job-1',
        validationRunId: 'run-1',
        source: ValidationFindingSource.AI,
        status: ValidationFindingStatus.PENDING,
        modelProvider: 'openai',
        modelName: 'test-model',
      }),
    ]);
    expect(validationRuns.markCompleted).toHaveBeenCalledWith('run-1', 'project-1', 'org-1', {
      findingCount: 1,
      redactionCount: 1,
      selectedFileCount: 2,
      inputCharacterCount: 60,
    });
  });

  it('completes successfully when the provider reports zero findings', async () => {
    validator.validate.mockResolvedValue({ findings: [] });

    await expect(service.execute(input)).resolves.toEqual({
      validationRunId: 'run-1',
      findingCount: 0,
    });
    expect(validationFindings.createMany).toHaveBeenCalledWith([]);
    expect(validationRuns.markCompleted).toHaveBeenCalledWith(
      'run-1',
      'project-1',
      'org-1',
      expect.objectContaining({ findingCount: 0 }),
    );
  });

  it('rejects unsupported conversion types before creating a run or invoking the provider', async () => {
    buildContext.execute.mockResolvedValue({
      ...context,
      conversionType: ConversionType.BMS_DSPF_TO_FRONTEND,
    });

    await expect(service.execute(input)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'VALIDATION_UNSUPPORTED_CONVERSION_TYPE' }),
    });
    expect(validationRuns.create).not.toHaveBeenCalled();
    expect(prepareContext.execute).not.toHaveBeenCalled();
    expect(validator.validate).not.toHaveBeenCalled();
  });

  it('marks the run failed when security preparation rejects the context', async () => {
    prepareContext.execute.mockImplementation(() => {
      throw new BadRequestException({
        code: 'VALIDATION_CONTEXT_TOO_LARGE',
        message: 'Prepared context exceeds the configured AI validation size limit',
      });
    });

    await expect(service.execute(input)).rejects.toBeInstanceOf(BadRequestException);
    expect(validator.validate).not.toHaveBeenCalled();
    expect(validationFindings.createMany).not.toHaveBeenCalled();
    expect(validationRuns.markFailed).toHaveBeenCalledWith('run-1', 'project-1', 'org-1', {
      failureCode: 'VALIDATION_CONTEXT_TOO_LARGE',
      failureMessage: 'Prepared context exceeds the configured AI validation size limit',
    });
  });

  it.each([
    ['provider failure', new AiValidatorError('AI_PROVIDER_TIMEOUT', 'AI provider request timed out')],
    [
      'malformed provider output',
      new AiValidatorError(
        'AI_PROVIDER_RESPONSE_INVALID',
        'AI provider returned an invalid validation response',
      ),
    ],
  ])('persists zero findings and fails the run on %s', async (_name, error) => {
    validator.validate.mockRejectedValue(error);

    await expect(service.execute(input)).rejects.toMatchObject({
      response: expect.objectContaining({ code: error.code, message: error.message }),
    });
    expect(validationFindings.createMany).not.toHaveBeenCalled();
    expect(validationRuns.markFailed).toHaveBeenCalledWith(
      'run-1',
      'project-1',
      'org-1',
      expect.objectContaining({
        failureCode: error.code,
        failureMessage: error.message,
        redactionCount: 1,
      }),
    );
  });

  it('sanitizes persistence failures without exposing source or provider bodies', async () => {
    validationFindings.createMany.mockRejectedValue(
      new Error('database rejected raw source and provider body'),
    );

    await expect(service.execute(input)).rejects.toMatchObject({
      response: {
        code: 'VALIDATION_EXECUTION_FAILED',
        message: 'AI validation could not be completed',
      },
    });
    expect(validationRuns.markFailed).toHaveBeenCalledWith(
      'run-1',
      'project-1',
      'org-1',
      expect.objectContaining({ failureCode: 'VALIDATION_EXECUTION_FAILED' }),
    );
  });
});
