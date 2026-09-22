import { MongoValidationRunRepository } from '../src/modules/validation/infrastructure/mongo-validation-run.repository';

describe('MongoValidationRunRepository query isolation', () => {
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
      }),
    );
  });
});
