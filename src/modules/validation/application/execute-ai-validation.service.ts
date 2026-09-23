import { createHash } from 'crypto';
import { HttpException, Inject, Injectable } from '@nestjs/common';
import { ConversionType } from '../../projects/domain/project.types';
import { AiValidationRuntimeGuard } from './ai-validation-runtime.guard';
import { BuildValidationContextService } from './build-validation-context.service';
import { PrepareAiValidationContextService } from './prepare-ai-validation-context.service';
import { ReconcileValidationRunService } from './reconcile-validation-run.service';
import { AiValidatorError } from '../domain/ai-validator.error';
import {
  AI_VALIDATOR,
  AiValidationFindingDraft,
  AiValidatorPort,
} from '../domain/ai-validator.port';
import { ValidationExecutionError } from '../domain/validation-execution.error';
import {
  UpsertValidationFindingInput,
  VALIDATION_FINDING_REPOSITORY,
  ValidationFindingRepository,
} from '../domain/validation-finding.repository';
import {
  ValidationFindingSource,
  ValidationFindingStatus,
} from '../domain/validation-finding.types';
import {
  VALIDATION_RUN_REPOSITORY,
  ValidationRunRepository,
} from '../domain/validation-run.repository';
import { ValidationRunRecord, ValidationRunStatus } from '../domain/validation-run.types';

export interface ExecuteAiValidationInput {
  validationRunId: string;
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
    private readonly runtimeGuard: AiValidationRuntimeGuard,
    private readonly reconcileRun: ReconcileValidationRunService,
    @Inject(AI_VALIDATOR) private readonly aiValidator: AiValidatorPort,
    @Inject(VALIDATION_RUN_REPOSITORY)
    private readonly validationRuns: ValidationRunRepository,
    @Inject(VALIDATION_FINDING_REPOSITORY)
    private readonly validationFindings: ValidationFindingRepository,
  ) {}

  async execute(input: ExecuteAiValidationInput): Promise<ExecuteAiValidationResult> {
    try {
      const run = await this.requireProcessingRun(input);
      const metadata = this.runtimeGuard.assertAvailable();
      this.requireStableProvider(run, metadata);

      if (run.resultsPersistedAt) {
        return {
          validationRunId: run.id,
          findingCount: await this.reconcileRun.execute(run),
        };
      }

      const existingFindingCount = await this.validationFindings.countByRun(
        run.id,
        run.projectId,
        run.organizationId,
      );
      if (existingFindingCount > 0) {
        throw new ValidationExecutionError(
          'VALIDATION_RESULT_PERSISTENCE_AMBIGUOUS',
          'AI validation result persistence is incomplete',
          false,
        );
      }

      const context = await this.buildContext.execute(input);
      if (context.conversionType !== ConversionType.COBOL_TO_JAVA) {
        throw new ValidationExecutionError(
          'VALIDATION_UNSUPPORTED_CONVERSION_TYPE',
          'AI semantic validation currently supports COBOL_TO_JAVA only',
          false,
        );
      }

      const prepared = this.prepareContext.execute(context);
      const result = await this.aiValidator.validate(prepared.input);
      const findings = this.uniqueFindings(
        result.findings.map((finding) =>
          this.toPersistenceInput(input, run.screenId, metadata, finding),
        ),
      );

      await this.validationFindings.upsertManyForRun(findings);
      const resultsPersistedAt = new Date();
      const markerPersisted = await this.validationRuns.markResultsPersisted(
        run.id,
        run.projectId,
        run.organizationId,
        {
          findingCount: findings.length,
          redactionCount: prepared.redactionCount,
          selectedFileCount: prepared.selectedFileCount,
          inputCharacterCount: prepared.inputCharacterCount,
          resultsPersistedAt,
        },
      );
      if (!markerPersisted) {
        throw new ValidationExecutionError(
          'VALIDATION_RUN_STATE_CONFLICT',
          'AI validation run state changed during result persistence',
          false,
        );
      }

      const persistedRun: ValidationRunRecord = {
        ...run,
        findingCount: findings.length,
        expectedFindingCount: findings.length,
        resultsPersistedAt,
        redactionCount: prepared.redactionCount,
        selectedFileCount: prepared.selectedFileCount,
        inputCharacterCount: prepared.inputCharacterCount,
      };
      return {
        validationRunId: run.id,
        findingCount: await this.reconcileRun.execute(persistedRun),
      };
    } catch (error) {
      throw this.toExecutionError(error);
    }
  }

  private async requireProcessingRun(
    input: ExecuteAiValidationInput,
  ): Promise<ValidationRunRecord> {
    const run = await this.validationRuns.findById(
      input.validationRunId,
      input.projectId,
      input.organizationId,
    );
    if (
      !run ||
      run.conversionJobId !== input.conversionJobId ||
      run.status !== ValidationRunStatus.PROCESSING
    ) {
      throw new ValidationExecutionError(
        'VALIDATION_RUN_NOT_PROCESSING',
        'AI validation run is not available for processing',
        false,
      );
    }
    return run;
  }

  private requireStableProvider(
    run: ValidationRunRecord,
    metadata: ReturnType<AiValidatorPort['getMetadata']>,
  ): void {
    if (
      run.provider !== metadata.provider ||
      run.model !== metadata.model ||
      run.promptVersion !== metadata.promptVersion
    ) {
      throw new ValidationExecutionError(
        'VALIDATION_AI_CONFIGURATION_CHANGED',
        'AI validation configuration changed after the run was queued',
        false,
      );
    }
  }

  private toPersistenceInput(
    input: ExecuteAiValidationInput,
    screenId: string | undefined,
    metadata: ReturnType<AiValidatorPort['getMetadata']>,
    finding: AiValidationFindingDraft,
  ): UpsertValidationFindingInput {
    const base = {
      organizationId: input.organizationId,
      projectId: input.projectId,
      conversionJobId: input.conversionJobId,
      validationRunId: input.validationRunId,
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
    return { ...base, fingerprint: this.fingerprint(finding) };
  }

  private uniqueFindings(findings: UpsertValidationFindingInput[]): UpsertValidationFindingInput[] {
    return [...new Map(findings.map((finding) => [finding.fingerprint, finding])).values()];
  }

  private fingerprint(finding: AiValidationFindingDraft): string {
    const normalize = (value: string | undefined): string | null =>
      value ? value.trim().replace(/\s+/g, ' ').toLowerCase() : null;
    const location = (value: AiValidationFindingDraft['sourceLocation']) =>
      value
        ? {
            file: value.file?.replace(/\\/g, '/').toLowerCase() ?? null,
            startLine: value.startLine ?? null,
            endLine: value.endLine ?? null,
          }
        : null;
    const canonical = {
      category: finding.category,
      severity: finding.severity,
      title: normalize(finding.title),
      explanation: normalize(finding.explanation),
      expectedBehavior: normalize(finding.expectedBehavior),
      actualBehavior: normalize(finding.actualBehavior),
      suggestion: normalize(finding.suggestion),
      sourceLocation: location(finding.sourceLocation),
      targetLocation: location(finding.targetLocation),
    };
    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  }

  private toExecutionError(error: unknown): ValidationExecutionError {
    if (error instanceof ValidationExecutionError) return error;
    if (error instanceof AiValidatorError) {
      return new ValidationExecutionError(
        error.code,
        error.message,
        error.code === 'AI_PROVIDER_TIMEOUT' || error.code === 'AI_PROVIDER_UNAVAILABLE',
      );
    }
    if (error instanceof HttpException) {
      const response = error.getResponse();
      if (typeof response === 'object' && response !== null) {
        const code = 'code' in response ? response.code : undefined;
        const message = 'message' in response ? response.message : undefined;
        if (typeof code === 'string' && typeof message === 'string') {
          return new ValidationExecutionError(code, message, false);
        }
      }
    }
    return new ValidationExecutionError(
      'VALIDATION_EXECUTION_TRANSIENT_FAILURE',
      'AI validation could not be completed',
      true,
    );
  }
}
