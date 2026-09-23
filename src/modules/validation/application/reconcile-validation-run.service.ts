import { Inject, Injectable } from '@nestjs/common';
import {
  VALIDATION_FINDING_REPOSITORY,
  ValidationFindingRepository,
} from '../domain/validation-finding.repository';
import { ValidationExecutionError } from '../domain/validation-execution.error';
import {
  VALIDATION_RUN_REPOSITORY,
  ValidationRunRepository,
} from '../domain/validation-run.repository';
import { ValidationRunRecord, ValidationRunStatus } from '../domain/validation-run.types';

@Injectable()
export class ReconcileValidationRunService {
  constructor(
    @Inject(VALIDATION_RUN_REPOSITORY)
    private readonly validationRuns: ValidationRunRepository,
    @Inject(VALIDATION_FINDING_REPOSITORY)
    private readonly validationFindings: ValidationFindingRepository,
  ) {}

  async execute(run: ValidationRunRecord): Promise<number> {
    if (!run.resultsPersistedAt || run.expectedFindingCount === undefined) {
      throw new ValidationExecutionError(
        'VALIDATION_RESULT_PERSISTENCE_AMBIGUOUS',
        'AI validation result persistence is incomplete',
        false,
      );
    }

    const actualFindingCount = await this.validationFindings.countByRun(
      run.id,
      run.projectId,
      run.organizationId,
    );
    if (actualFindingCount !== run.expectedFindingCount) {
      throw new ValidationExecutionError(
        'VALIDATION_RESULT_PERSISTENCE_AMBIGUOUS',
        'AI validation result persistence is inconsistent',
        false,
      );
    }

    const completed = await this.validationRuns.markCompleted(
      run.id,
      run.projectId,
      run.organizationId,
      {
        findingCount: actualFindingCount,
        redactionCount: run.redactionCount ?? 0,
        selectedFileCount: run.selectedFileCount ?? 0,
        inputCharacterCount: run.inputCharacterCount ?? 0,
      },
    );
    if (!completed) {
      const latest = await this.validationRuns.findById(run.id, run.projectId, run.organizationId);
      if (
        latest?.status !== ValidationRunStatus.COMPLETED ||
        latest.findingCount !== actualFindingCount
      ) {
        throw new ValidationExecutionError(
          'VALIDATION_RUN_FINALIZATION_CONFLICT',
          'AI validation run could not be finalized safely',
          false,
        );
      }
    }
    return actualFindingCount;
  }
}
