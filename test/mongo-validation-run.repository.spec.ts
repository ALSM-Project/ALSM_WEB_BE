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
});
