import { MongoValidationFindingRepository } from '../src/modules/validation/infrastructure/mongo-validation-finding.repository';

describe('MongoValidationFindingRepository query isolation', () => {
  it('finds a finding with id, run, project, and organization in one predicate', async () => {
    const exec = jest.fn().mockResolvedValue(null);
    const findOne = jest.fn().mockReturnValue({ exec });
    const repository = new MongoValidationFindingRepository({ findOne } as never);

    await expect(
      repository.findById('finding-1', 'run-1', 'project-1', 'org-1'),
    ).resolves.toBeNull();

    expect(findOne).toHaveBeenCalledWith({
      _id: 'finding-1',
      validationRunId: 'run-1',
      projectId: 'project-1',
      organizationId: 'org-1',
    });
  });

  it('lists findings with run, project, and organization scope', async () => {
    const exec = jest.fn().mockResolvedValue([]);
    const sort = jest.fn().mockReturnValue({ exec });
    const find = jest.fn().mockReturnValue({ sort });
    const repository = new MongoValidationFindingRepository({ find } as never);

    await expect(repository.listByRun('run-1', 'project-1', 'org-1')).resolves.toEqual([]);

    expect(find).toHaveBeenCalledWith({
      validationRunId: 'run-1',
      projectId: 'project-1',
      organizationId: 'org-1',
    });
    expect(sort).toHaveBeenCalledWith({ createdAt: 1 });
  });
});
