import { MongoValidationFindingRepository } from '../src/modules/validation/infrastructure/mongo-validation-finding.repository';
import { ValidationFindingSchema } from '../src/modules/validation/infrastructure/validation-finding.schema';
import {
  ValidationFindingCategory,
  ValidationFindingSeverity,
  ValidationFindingSource,
  ValidationFindingStatus,
} from '../src/modules/validation/domain/validation-finding.types';

describe('MongoValidationFindingRepository query isolation', () => {
  it('defines a tenant/run-scoped unique sparse fingerprint index', () => {
    expect(ValidationFindingSchema.indexes()).toContainEqual([
      { organizationId: 1, projectId: 1, validationRunId: 1, fingerprint: 1 },
      expect.objectContaining({
        unique: true,
        sparse: true,
        name: 'unique_validation_finding_fingerprint',
      }),
    ]);
  });

  it('upserts retry findings by tenant, run, and application fingerprint', async () => {
    const bulkWrite = jest.fn().mockResolvedValue(undefined);
    const repository = new MongoValidationFindingRepository({ bulkWrite } as never);
    const id = {
      organizationId: '507f1f77bcf86cd799439011',
      projectId: '507f1f77bcf86cd799439012',
      conversionJobId: '507f1f77bcf86cd799439013',
      validationRunId: '507f1f77bcf86cd799439014',
    };

    const finding = {
      ...id,
      fingerprint: 'fingerprint-1',
      source: ValidationFindingSource.AI,
      category: ValidationFindingCategory.LOGIC_MISMATCH,
      severity: ValidationFindingSeverity.HIGH,
      status: ValidationFindingStatus.PENDING,
      title: 'Mismatch',
      explanation: 'Behavior differs',
    };

    await repository.upsertManyForRun([finding, finding]);

    expect(bulkWrite).toHaveBeenCalledWith(
      [
        {
          updateOne: {
            filter: expect.objectContaining({
              fingerprint: 'fingerprint-1',
              organizationId: expect.anything(),
              projectId: expect.anything(),
              validationRunId: expect.anything(),
            }),
            update: {
              $setOnInsert: expect.objectContaining({ fingerprint: 'fingerprint-1' }),
            },
            upsert: true,
          },
        },
      ],
      { ordered: false },
    );
  });

  it('counts findings with run, project, and organization scope', async () => {
    const exec = jest.fn().mockResolvedValue(2);
    const countDocuments = jest.fn().mockReturnValue({ exec });
    const repository = new MongoValidationFindingRepository({ countDocuments } as never);

    await expect(repository.countByRun('run-1', 'project-1', 'org-1')).resolves.toBe(2);
    expect(countDocuments).toHaveBeenCalledWith({
      validationRunId: 'run-1',
      projectId: 'project-1',
      organizationId: 'org-1',
    });
  });

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
