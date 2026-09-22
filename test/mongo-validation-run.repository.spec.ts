import { MongoValidationRunRepository } from '../src/modules/validation/infrastructure/mongo-validation-run.repository';
import { ValidationRunSchema } from '../src/modules/validation/infrastructure/validation-run.schema';

describe('MongoValidationRunRepository query isolation', () => {
  it('defines a unique sparse index for the internal active execution key', () => {
    expect(ValidationRunSchema.indexes()).toContainEqual([
      { activeExecutionKey: 1 },
      expect.objectContaining({
        unique: true,
        sparse: true,
        name: 'unique_active_ai_validation_execution',
      }),
    ]);
  });

  it('returns the existing active run when a concurrent insert loses the unique-key race', async () => {
    const activeRun = {
      id: 'run-1',
      organizationId: { toString: () => '507f1f77bcf86cd799439011' },
      projectId: { toString: () => '507f1f77bcf86cd799439012' },
      conversionJobId: { toString: () => '507f1f77bcf86cd799439013' },
      status: 'QUEUED',
      ruleValidationEnabled: false,
      aiValidationEnabled: true,
      findingCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const exec = jest.fn().mockResolvedValue(activeRun);
    const findOne = jest.fn().mockReturnValue({ exec });
    const create = jest.fn().mockRejectedValue({ code: 11_000 });
    const repository = new MongoValidationRunRepository({ create, findOne } as never);

    const result = await repository.createOrGetActiveAiRun({
      organizationId: '507f1f77bcf86cd799439011',
      projectId: '507f1f77bcf86cd799439012',
      conversionJobId: '507f1f77bcf86cd799439013',
      status: 'QUEUED' as never,
      ruleValidationEnabled: false,
      aiValidationEnabled: true,
      findingCount: 0,
    });

    expect(result).toEqual({ run: expect.objectContaining({ id: 'run-1' }), created: false });
    expect(findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: '507f1f77bcf86cd799439011',
        projectId: '507f1f77bcf86cd799439012',
        conversionJobId: '507f1f77bcf86cd799439013',
        status: { $in: ['QUEUED', 'PROCESSING'] },
      }),
    );
  });

  it('finds a run with id, project, and organization in one predicate', async () => {
    const exec = jest.fn().mockResolvedValue(null);
    const findOne = jest.fn().mockReturnValue({ exec });
    const repository = new MongoValidationRunRepository({ findOne } as never);

    await expect(repository.findById('run-1', 'project-1', 'org-1')).resolves.toBeNull();

    expect(findOne).toHaveBeenCalledWith({
      _id: 'run-1',
      projectId: 'project-1',
      organizationId: 'org-1',
    });
  });

  it('lists runs with conversion, project, and organization scope', async () => {
    const exec = jest.fn().mockResolvedValue([]);
    const sort = jest.fn().mockReturnValue({ exec });
    const find = jest.fn().mockReturnValue({ sort });
    const repository = new MongoValidationRunRepository({ find } as never);

    await expect(repository.listByConversionJob('job-1', 'project-1', 'org-1')).resolves.toEqual(
      [],
    );

    expect(find).toHaveBeenCalledWith({
      conversionJobId: 'job-1',
      projectId: 'project-1',
      organizationId: 'org-1',
    });
    expect(sort).toHaveBeenCalledWith({ createdAt: -1 });
  });

  it('marks completion with run, project, and organization scope', async () => {
    const exec = jest.fn().mockResolvedValue(undefined);
    const updateOne = jest.fn().mockReturnValue({ exec });
    const repository = new MongoValidationRunRepository({ updateOne } as never);

    await repository.markCompleted('run-1', 'project-1', 'org-1', {
      findingCount: 2,
      redactionCount: 1,
      selectedFileCount: 3,
      inputCharacterCount: 500,
    });

    expect(updateOne).toHaveBeenCalledWith(
      { _id: 'run-1', projectId: 'project-1', organizationId: 'org-1' },
      expect.objectContaining({
        $set: expect.objectContaining({ status: 'COMPLETED', findingCount: 2 }),
        $unset: { activeExecutionKey: 1 },
      }),
    );
  });

  it('marks failure with run, project, and organization scope', async () => {
    const exec = jest.fn().mockResolvedValue(undefined);
    const updateOne = jest.fn().mockReturnValue({ exec });
    const repository = new MongoValidationRunRepository({ updateOne } as never);

    await repository.markFailed('run-1', 'project-1', 'org-1', {
      failureCode: 'AI_PROVIDER_TIMEOUT',
      failureMessage: 'AI provider request timed out',
    });

    expect(updateOne).toHaveBeenCalledWith(
      { _id: 'run-1', projectId: 'project-1', organizationId: 'org-1' },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'FAILED',
          findingCount: 0,
          failureCode: 'AI_PROVIDER_TIMEOUT',
        }),
        $unset: { activeExecutionKey: 1 },
      }),
    );
  });
});
