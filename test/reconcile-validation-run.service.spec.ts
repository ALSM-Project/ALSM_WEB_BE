import { ReconcileValidationRunService } from '../src/modules/validation/application/reconcile-validation-run.service';
import { ValidationFindingRepository } from '../src/modules/validation/domain/validation-finding.repository';
import { ValidationRunRepository } from '../src/modules/validation/domain/validation-run.repository';
import { ValidationRunStatus } from '../src/modules/validation/domain/validation-run.types';

describe('ReconcileValidationRunService', () => {
  const validationRuns = { markCompleted: jest.fn() };
  const validationFindings = { countByRun: jest.fn() };
  const service = new ReconcileValidationRunService(
    validationRuns as unknown as ValidationRunRepository,
    validationFindings as unknown as ValidationFindingRepository,
  );
  const run = {
    id: 'run-1',
    organizationId: 'org-1',
    projectId: 'project-1',
    conversionJobId: 'job-1',
    status: ValidationRunStatus.PROCESSING,
    ruleValidationEnabled: false,
    aiValidationEnabled: true,
    findingCount: 2,
    expectedFindingCount: 2,
    resultsPersistedAt: new Date(),
    redactionCount: 1,
    selectedFileCount: 2,
    inputCharacterCount: 50,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    validationFindings.countByRun.mockResolvedValue(2);
    validationRuns.markCompleted.mockResolvedValue(undefined);
  });

  it('retries only the completion transition when persisted findings match the marker', async () => {
    await expect(service.execute(run)).resolves.toBe(2);

    expect(validationRuns.markCompleted).toHaveBeenCalledWith('run-1', 'project-1', 'org-1', {
      findingCount: 2,
      redactionCount: 1,
      selectedFileCount: 2,
      inputCharacterCount: 50,
    });
  });

  it('distinguishes a persisted zero-finding result from a run that has not executed', async () => {
    validationFindings.countByRun.mockResolvedValue(0);

    await expect(
      service.execute({ ...run, findingCount: 0, expectedFindingCount: 0 }),
    ).resolves.toBe(0);
    expect(validationRuns.markCompleted).toHaveBeenCalledWith(
      'run-1',
      'project-1',
      'org-1',
      expect.objectContaining({ findingCount: 0 }),
    );
  });

  it('fails closed when the marker and persisted finding count disagree', async () => {
    validationFindings.countByRun.mockResolvedValue(1);

    await expect(service.execute(run)).rejects.toMatchObject({
      code: 'VALIDATION_RESULT_PERSISTENCE_AMBIGUOUS',
      retryable: false,
    });
    expect(validationRuns.markCompleted).not.toHaveBeenCalled();
  });
});
