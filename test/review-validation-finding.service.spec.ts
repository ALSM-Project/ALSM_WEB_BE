import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AuditRepository } from '../src/modules/audit/domain/audit.repository';
import { OrganizationAuthorizationService } from '../src/modules/organizations/application/organization-authorization.service';
import { OrganizationContextService } from '../src/modules/organizations/application/organization-context.service';
import { OrganizationRole } from '../src/modules/organizations/domain/organization.types';
import { ProjectService } from '../src/modules/projects/application/project.service';
import { ReviewValidationFindingService } from '../src/modules/validation/application/review-validation-finding.service';
import { ValidationFindingRepository } from '../src/modules/validation/domain/validation-finding.repository';
import {
  ValidationFindingCategory,
  ValidationFindingRecord,
  ValidationFindingSeverity,
  ValidationFindingSource,
  ValidationFindingStatus,
} from '../src/modules/validation/domain/validation-finding.types';
import { ValidationRunRepository } from '../src/modules/validation/domain/validation-run.repository';
import { ValidationRunStatus } from '../src/modules/validation/domain/validation-run.types';

describe('ReviewValidationFindingService', () => {
  const validationFindings = { findById: jest.fn(), reviewFinding: jest.fn() };
  const validationRuns = { findById: jest.fn() };
  const organizationContext = { resolve: jest.fn() };
  const authorization = { require: jest.fn() };
  const projects = { getForOrganization: jest.fn() };
  const audit = { append: jest.fn() };
  const service = new ReviewValidationFindingService(
    validationFindings as unknown as ValidationFindingRepository,
    validationRuns as unknown as ValidationRunRepository,
    organizationContext as unknown as OrganizationContextService,
    authorization as unknown as OrganizationAuthorizationService,
    projects as unknown as ProjectService,
    audit as unknown as AuditRepository,
  );
  const run = {
    id: 'run-1',
    organizationId: 'org-1',
    projectId: 'project-1',
    conversionJobId: 'job-1',
    status: ValidationRunStatus.COMPLETED,
    ruleValidationEnabled: false,
    aiValidationEnabled: true,
    findingCount: 1,
    createdAt: new Date('2026-09-23T00:00:00.000Z'),
    updatedAt: new Date('2026-09-23T00:01:00.000Z'),
  };
  const finding: ValidationFindingRecord = {
    id: 'finding-1',
    organizationId: 'org-1',
    projectId: 'project-1',
    conversionJobId: 'job-1',
    validationRunId: 'run-1',
    source: ValidationFindingSource.AI,
    category: ValidationFindingCategory.LOGIC_MISMATCH,
    severity: ValidationFindingSeverity.HIGH,
    status: ValidationFindingStatus.PENDING,
    title: 'Mismatch',
    explanation: 'Behavior differs',
    createdAt: new Date('2026-09-23T00:00:00.000Z'),
    updatedAt: new Date('2026-09-23T00:00:00.000Z'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    organizationContext.resolve.mockResolvedValue({
      id: 'org-1',
      members: [{ userId: 'reviewer-1', role: OrganizationRole.MEMBER }],
    });
    projects.getForOrganization.mockResolvedValue({ id: 'project-1', organizationId: 'org-1' });
    validationRuns.findById.mockResolvedValue(run);
    validationFindings.findById.mockResolvedValue(finding);
    validationFindings.reviewFinding.mockImplementation(async (input) => ({
      outcome: 'UPDATED',
      finding: {
        ...finding,
        status: input.newStatus,
        reviewedBy: input.reviewedBy,
        reviewedAt: input.reviewedAt,
        reviewNote: input.reviewNote,
      },
    }));
    audit.append.mockResolvedValue(undefined);
  });

  const execute = (
    status: ValidationFindingStatus,
    reviewNote?: string,
  ): Promise<ValidationFindingRecord> =>
    service.execute({
      userId: 'reviewer-1',
      organizationHeader: 'org-1',
      projectId: 'project-1',
      validationRunId: 'run-1',
      findingId: 'finding-1',
      status,
      reviewNote,
    });

  it.each([
    [ValidationFindingStatus.PENDING, ValidationFindingStatus.NEEDS_CORRECTION, undefined],
    [ValidationFindingStatus.PENDING, ValidationFindingStatus.MANUAL_REVIEW, undefined],
    [ValidationFindingStatus.PENDING, ValidationFindingStatus.NOT_APPLICABLE, 'Not relevant'],
    [ValidationFindingStatus.NEEDS_CORRECTION, ValidationFindingStatus.RESOLVED, undefined],
    [ValidationFindingStatus.NOT_APPLICABLE, ValidationFindingStatus.MANUAL_REVIEW, undefined],
    [ValidationFindingStatus.RESOLVED, ValidationFindingStatus.MANUAL_REVIEW, undefined],
  ])('allows %s -> %s', async (currentStatus, newStatus, reviewNote) => {
    validationFindings.findById.mockResolvedValue({ ...finding, status: currentStatus });

    await expect(execute(newStatus, reviewNote)).resolves.toMatchObject({ status: newStatus });
    expect(validationFindings.reviewFinding).toHaveBeenCalledWith(
      expect.objectContaining({ expectedStatus: currentStatus, newStatus }),
    );
  });

  it('requires a trimmed non-empty note for NOT_APPLICABLE', async () => {
    await expect(execute(ValidationFindingStatus.NOT_APPLICABLE, '   ')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(validationFindings.reviewFinding).not.toHaveBeenCalled();
    expect(audit.append).not.toHaveBeenCalled();
  });

  it('trims a supplied review note before persistence', async () => {
    await execute(ValidationFindingStatus.NEEDS_CORRECTION, '  Confirmed  ');
    expect(validationFindings.reviewFinding).toHaveBeenCalledWith(
      expect.objectContaining({ reviewNote: 'Confirmed' }),
    );
  });

  it('rejects review notes longer than 1000 characters', async () => {
    await expect(
      execute(ValidationFindingStatus.NEEDS_CORRECTION, 'x'.repeat(1001)),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(validationFindings.reviewFinding).not.toHaveBeenCalled();
  });

  it('rejects an invalid transition without an audit event', async () => {
    validationFindings.findById.mockResolvedValue({
      ...finding,
      status: ValidationFindingStatus.NEEDS_CORRECTION,
    });

    await expect(
      execute(ValidationFindingStatus.NOT_APPLICABLE, 'Not relevant'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(validationFindings.reviewFinding).not.toHaveBeenCalled();
    expect(audit.append).not.toHaveBeenCalled();
  });

  it('rejects PENDING as a human-review target', async () => {
    await expect(execute(ValidationFindingStatus.PENDING)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'VALIDATION_FINDING_REVIEW_STATUS_INVALID' }),
    });
    expect(validationFindings.reviewFinding).not.toHaveBeenCalled();
  });

  it('uses only the authenticated user and server time for reviewer metadata', async () => {
    const before = Date.now();
    const reviewed = await execute(ValidationFindingStatus.NEEDS_CORRECTION);
    const after = Date.now();

    expect(reviewed.reviewedBy).toBe('reviewer-1');
    expect(reviewed.reviewedAt!.getTime()).toBeGreaterThanOrEqual(before);
    expect(reviewed.reviewedAt!.getTime()).toBeLessThanOrEqual(after);
    expect(validationFindings.reviewFinding).toHaveBeenCalledWith(
      expect.objectContaining({ reviewedBy: 'reviewer-1', reviewedAt: expect.any(Date) }),
    );
  });

  it('enforces the established project-write role policy', async () => {
    await execute(ValidationFindingStatus.NEEDS_CORRECTION);
    expect(authorization.require).toHaveBeenCalledWith(expect.anything(), 'reviewer-1', [
      OrganizationRole.OWNER,
      OrganizationRole.ADMIN,
      OrganizationRole.MEMBER,
    ]);
  });

  it('denies a user outside the requested organization before resource access', async () => {
    organizationContext.resolve.mockRejectedValue(new ForbiddenException());

    await expect(execute(ValidationFindingStatus.NEEDS_CORRECTION)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(projects.getForOrganization).not.toHaveBeenCalled();
    expect(validationFindings.reviewFinding).not.toHaveBeenCalled();
  });

  it('does not access a run when the project is outside the organization', async () => {
    projects.getForOrganization.mockRejectedValue(new NotFoundException());

    await expect(execute(ValidationFindingStatus.NEEDS_CORRECTION)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(validationRuns.findById).not.toHaveBeenCalled();
  });

  it('does not update a finding through a wrong validation run', async () => {
    validationRuns.findById.mockResolvedValue(null);

    await expect(execute(ValidationFindingStatus.NEEDS_CORRECTION)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'VALIDATION_RUN_NOT_FOUND' }),
    });
    expect(validationFindings.findById).not.toHaveBeenCalled();
    expect(validationFindings.reviewFinding).not.toHaveBeenCalled();
  });

  it('does not update a finding from another tenant', async () => {
    validationFindings.findById.mockResolvedValue(null);

    await expect(execute(ValidationFindingStatus.NEEDS_CORRECTION)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'VALIDATION_FINDING_NOT_FOUND' }),
    });
    expect(validationFindings.findById).toHaveBeenCalledWith(
      'finding-1',
      'run-1',
      'project-1',
      'org-1',
    );
    expect(validationFindings.reviewFinding).not.toHaveBeenCalled();
  });

  it('rejects a finding whose conversion relationship does not match its run', async () => {
    validationFindings.findById.mockResolvedValue({ ...finding, conversionJobId: 'job-2' });

    await expect(execute(ValidationFindingStatus.NEEDS_CORRECTION)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(validationFindings.reviewFinding).not.toHaveBeenCalled();
  });

  it('returns conflict and creates no audit event after a stale CAS update', async () => {
    validationFindings.reviewFinding.mockResolvedValue({ outcome: 'CONFLICT' });

    await expect(execute(ValidationFindingStatus.NEEDS_CORRECTION)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(audit.append).not.toHaveBeenCalled();
  });

  it('maps a disappeared scoped finding to not found without an audit event', async () => {
    validationFindings.reviewFinding.mockResolvedValue({ outcome: 'NOT_FOUND' });

    await expect(execute(ValidationFindingStatus.NEEDS_CORRECTION)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(audit.append).not.toHaveBeenCalled();
  });

  it('appends one safe audit event after a successful review', async () => {
    await execute(ValidationFindingStatus.NOT_APPLICABLE, '  Not used by this conversion  ');

    expect(audit.append).toHaveBeenCalledWith({
      actorUserId: 'reviewer-1',
      organizationId: 'org-1',
      action: 'VALIDATION_FINDING_REVIEWED',
      resourceType: 'validation_finding',
      resourceId: 'finding-1',
      metadata: {
        validationRunId: 'run-1',
        conversionJobId: 'job-1',
        projectId: 'project-1',
        previousStatus: ValidationFindingStatus.PENDING,
        newStatus: ValidationFindingStatus.NOT_APPLICABLE,
        reviewNoteProvided: 'true',
      },
    });
    const metadata = audit.append.mock.calls[0][0].metadata;
    expect(metadata).not.toHaveProperty('reviewNote');
    expect(metadata).not.toHaveProperty('explanation');
    expect(metadata).not.toHaveProperty('sourceLocation');
  });
});
