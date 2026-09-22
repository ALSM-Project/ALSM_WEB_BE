import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConversionType } from '../../projects/domain/project.types';
import { BuildValidationContextService } from './build-validation-context.service';
import {
  PrepareAiValidationContextService,
  PreparedAiValidationContext,
} from './prepare-ai-validation-context.service';
import { AiValidatorError } from '../domain/ai-validator.error';
import { AI_VALIDATOR, AiValidationFindingDraft, AiValidatorPort } from '../domain/ai-validator.port';
import {
  CreateValidationFindingInput,
  VALIDATION_FINDING_REPOSITORY,
  ValidationFindingRepository,
} from '../domain/validation-finding.repository';
import {
  ValidationFindingSource,
  ValidationFindingStatus,
} from '../domain/validation-finding.types';
import {
  FailValidationRunInput,
  VALIDATION_RUN_REPOSITORY,
  ValidationRunRepository,
} from '../domain/validation-run.repository';
import { ValidationRunStatus } from '../domain/validation-run.types';

export interface ExecuteAiValidationInput {
  organizationId: string;
  projectId: string;
  conversionJobId: string;
}

export interface ExecuteAiValidationResult {
  validationRunId: string;
  findingCount: number;
}

@Injectable()
export class ExecuteAiValidationService {
  constructor(
    private readonly buildContext: BuildValidationContextService,
    private readonly prepareContext: PrepareAiValidationContextService,
    @Inject(AI_VALIDATOR) private readonly aiValidator: AiValidatorPort,
    @Inject(VALIDATION_RUN_REPOSITORY)
    private readonly validationRuns: ValidationRunRepository,
    @Inject(VALIDATION_FINDING_REPOSITORY)
    private readonly validationFindings: ValidationFindingRepository,
  ) {}

  async execute(input: ExecuteAiValidationInput): Promise<ExecuteAiValidationResult> {
    const context = await this.buildContext.execute(input);
    if (context.conversionType !== ConversionType.COBOL_TO_JAVA) {
      throw new BadRequestException({
        code: 'VALIDATION_UNSUPPORTED_CONVERSION_TYPE',
        message: 'AI semantic validation currently supports COBOL_TO_JAVA only',
      });
    }

    const validatorMetadata = this.aiValidator.getMetadata();
    const run = await this.validationRuns.create({
      organizationId: context.organizationId,
      projectId: context.projectId,
      conversionJobId: context.conversionJobId,
      screenId: context.screenId,
      status: ValidationRunStatus.PROCESSING,
      ruleValidationEnabled: false,
      aiValidationEnabled: true,
      findingCount: 0,
      provider: validatorMetadata.provider,
      model: validatorMetadata.model,
      promptVersion: validatorMetadata.promptVersion,
      startedAt: new Date(),
    });

    let prepared: PreparedAiValidationContext | undefined;
    try {
      prepared = this.prepareContext.execute(context);
      const result = await this.aiValidator.validate(prepared.input);
      const findings = result.findings.map((finding) =>
        this.toPersistenceInput(context, run.id, context.screenId, validatorMetadata, finding),
      );

      await this.validationFindings.createMany(findings);
      await this.validationRuns.markCompleted(run.id, context.projectId, context.organizationId, {
        findingCount: findings.length,
        redactionCount: prepared.redactionCount,
        selectedFileCount: prepared.selectedFileCount,
        inputCharacterCount: prepared.inputCharacterCount,
      });

      return { validationRunId: run.id, findingCount: findings.length };
    } catch (error) {
      const failure = this.sanitizeFailure(error, prepared);
      try {
        await this.validationRuns.markFailed(
          run.id,
          context.projectId,
          context.organizationId,
          failure,
        );
      } catch {
        // Preserve the original sanitized execution failure if lifecycle persistence also fails.
      }
      this.throwSanitized(error, failure);
    }
  }

  private toPersistenceInput(
    input: ExecuteAiValidationInput,
    validationRunId: string,
    screenId: string | undefined,
    metadata: ReturnType<AiValidatorPort['getMetadata']>,
    finding: AiValidationFindingDraft,
  ): CreateValidationFindingInput {
    return {
      organizationId: input.organizationId,
      projectId: input.projectId,
      conversionJobId: input.conversionJobId,
      validationRunId,
      screenId,
      source: ValidationFindingSource.AI,
      status: ValidationFindingStatus.PENDING,
      category: finding.category,
      severity: finding.severity,
      title: finding.title,
      explanation: finding.explanation,
      expectedBehavior: finding.expectedBehavior,
      actualBehavior: finding.actualBehavior,
      suggestion: finding.suggestion,
      sourceLocation: finding.sourceLocation,
      targetLocation: finding.targetLocation,
      confidence: finding.confidence,
      modelProvider: metadata.provider,
      modelName: metadata.model,
    };
  }

  private sanitizeFailure(
    error: unknown,
    prepared: PreparedAiValidationContext | undefined,
  ): FailValidationRunInput {
    const metadata = prepared
      ? {
          redactionCount: prepared.redactionCount,
          selectedFileCount: prepared.selectedFileCount,
          inputCharacterCount: prepared.inputCharacterCount,
        }
      : {};

    if (error instanceof AiValidatorError) {
      return { failureCode: error.code, failureMessage: error.message, ...metadata };
    }
    if (error instanceof HttpException) {
      const response = error.getResponse();
      if (typeof response === 'object' && response !== null) {
        const code = 'code' in response ? response.code : undefined;
        const message = 'message' in response ? response.message : undefined;
        if (typeof code === 'string' && typeof message === 'string') {
          return { failureCode: code, failureMessage: message, ...metadata };
        }
      }
    }
    return {
      failureCode: 'VALIDATION_EXECUTION_FAILED',
      failureMessage: 'AI validation could not be completed',
      ...metadata,
    };
  }

  private throwSanitized(error: unknown, failure: FailValidationRunInput): never {
    if (error instanceof HttpException) throw error;
    if (error instanceof AiValidatorError) {
      throw new ServiceUnavailableException({
        code: failure.failureCode,
        message: failure.failureMessage,
      });
    }
    throw new InternalServerErrorException({
      code: failure.failureCode,
      message: failure.failureMessage,
    });
  }
}
