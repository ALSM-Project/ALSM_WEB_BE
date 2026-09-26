import { MongoValidationFindingRepository } from '../src/modules/validation/infrastructure/mongo-validation-finding.repository';
import { ValidationFindingSchema } from '../src/modules/validation/infrastructure/validation-finding.schema';
import {
  ValidationFindingCategory,
  ValidationFindingSeverity,
  ValidationFindingSource,
  ValidationFindingStatus,
} from '../src/modules/validation/domain/validation-finding.types';

describe('MongoValidationFindingRepository query isolation', () => {
  it('defines a tenant/run-scoped unique fingerprint index for fingerprinted findings', () => {
    expect(ValidationFindingSchema.indexes()).toContainEqual([
      { organizationId: 1, projectId: 1, validationRunId: 1, fingerprint: 1 },
      expect.objectContaining({
        unique: true,
        partialFilterExpression: { fingerprint: { $type: 'string' } },
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

  it('reviews a finding with tenant, run, project, id, and expected-status CAS scope', async () => {
    const reviewedAt = new Date('2026-09-23T12:00:00.000Z');
    const document = {
      id: '507f1f77bcf86cd799439015',
      organizationId: { toString: () => '507f1f77bcf86cd799439011' },
      projectId: { toString: () => '507f1f77bcf86cd799439012' },
      conversionJobId: { toString: () => '507f1f77bcf86cd799439013' },
      validationRunId: { toString: () => '507f1f77bcf86cd799439014' },
      source: ValidationFindingSource.AI,
      category: ValidationFindingCategory.LOGIC_MISMATCH,
      severity: ValidationFindingSeverity.HIGH,
      status: ValidationFindingStatus.NEEDS_CORRECTION,
      title: 'Mismatch',
      explanation: 'Behavior differs',
      reviewedBy: { toString: () => '507f1f77bcf86cd799439016' },
      reviewedAt,
      reviewNote: 'Confirmed by reviewer',
      createdAt: reviewedAt,
      updatedAt: reviewedAt,
    };
    const exec = jest.fn().mockResolvedValue(document);
    const findOneAndUpdate = jest.fn().mockReturnValue({ exec });
    const repository = new MongoValidationFindingRepository({ findOneAndUpdate } as never);

    await expect(
      repository.reviewFinding({
        findingId: '507f1f77bcf86cd799439015',
        validationRunId: '507f1f77bcf86cd799439014',
        projectId: '507f1f77bcf86cd799439012',
        organizationId: '507f1f77bcf86cd799439011',
        expectedStatus: ValidationFindingStatus.PENDING,
        newStatus: ValidationFindingStatus.NEEDS_CORRECTION,
        reviewedBy: '507f1f77bcf86cd799439016',
        reviewedAt,
        reviewNote: 'Confirmed by reviewer',
      }),
    ).resolves.toEqual({
      outcome: 'UPDATED',
      finding: expect.objectContaining({ reviewNote: 'Confirmed by reviewer' }),
    });

    expect(findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: '507f1f77bcf86cd799439015',
        validationRunId: '507f1f77bcf86cd799439014',
        projectId: '507f1f77bcf86cd799439012',
        organizationId: '507f1f77bcf86cd799439011',
        status: ValidationFindingStatus.PENDING,
      },
      {
        $set: {
          status: ValidationFindingStatus.NEEDS_CORRECTION,
          reviewedBy: expect.anything(),
          reviewedAt,
          reviewNote: 'Confirmed by reviewer',
        },
      },
      { new: true },
    );
    const update = findOneAndUpdate.mock.calls[0][1];
    expect(update.$set).not.toHaveProperty('fingerprint');
    expect(update.$set).not.toHaveProperty('source');
    expect(update.$set).not.toHaveProperty('category');
    expect(update.$set).not.toHaveProperty('severity');
  });

  it('returns conflict when the finding still exists after a stale CAS update', async () => {
    const findOneAndUpdate = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    const exists = jest
      .fn()
      .mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: 'finding-1' }) });
    const repository = new MongoValidationFindingRepository({ findOneAndUpdate, exists } as never);

    await expect(
      repository.reviewFinding({
        findingId: 'finding-1',
        validationRunId: 'run-1',
        projectId: 'project-1',
        organizationId: 'org-1',
        expectedStatus: ValidationFindingStatus.PENDING,
        newStatus: ValidationFindingStatus.MANUAL_REVIEW,
        reviewedBy: '507f1f77bcf86cd799439016',
        reviewedAt: new Date(),
      }),
    ).resolves.toEqual({ outcome: 'CONFLICT' });

    expect(exists).toHaveBeenCalledWith({
      _id: 'finding-1',
      validationRunId: 'run-1',
      projectId: 'project-1',
      organizationId: 'org-1',
    });
  });

  it('returns not found without leaking an out-of-scope finding', async () => {
    const findOneAndUpdate = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    const exists = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    const repository = new MongoValidationFindingRepository({ findOneAndUpdate, exists } as never);

    await expect(
      repository.reviewFinding({
        findingId: 'finding-other-tenant',
        validationRunId: 'run-1',
        projectId: 'project-1',
        organizationId: 'org-1',
        expectedStatus: ValidationFindingStatus.PENDING,
        newStatus: ValidationFindingStatus.MANUAL_REVIEW,
        reviewedBy: '507f1f77bcf86cd799439016',
        reviewedAt: new Date(),
      }),
    ).resolves.toEqual({ outcome: 'NOT_FOUND' });
  });

  it('removes a stale note when a later review omits it', async () => {
    const findOneAndUpdate = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        id: 'finding-1',
        organizationId: { toString: () => 'org-1' },
        projectId: { toString: () => 'project-1' },
        conversionJobId: { toString: () => 'job-1' },
        validationRunId: { toString: () => 'run-1' },
        source: ValidationFindingSource.AI,
        category: ValidationFindingCategory.LOGIC_MISMATCH,
        severity: ValidationFindingSeverity.HIGH,
        status: ValidationFindingStatus.MANUAL_REVIEW,
        title: 'Mismatch',
        explanation: 'Behavior differs',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    });
    const repository = new MongoValidationFindingRepository({ findOneAndUpdate } as never);

    await repository.reviewFinding({
      findingId: 'finding-1',
      validationRunId: 'run-1',
      projectId: 'project-1',
      organizationId: 'org-1',
      expectedStatus: ValidationFindingStatus.NOT_APPLICABLE,
      newStatus: ValidationFindingStatus.MANUAL_REVIEW,
      reviewedBy: '507f1f77bcf86cd799439016',
      reviewedAt: new Date(),
    });

    expect(findOneAndUpdate.mock.calls[0][1]).toEqual({
      $set: expect.objectContaining({ status: ValidationFindingStatus.MANUAL_REVIEW }),
      $unset: { reviewNote: 1 },
    });
  });
});
