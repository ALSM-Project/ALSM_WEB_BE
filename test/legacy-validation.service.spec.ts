import { ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { LegacyValidationService } from '../src/modules/conversions/application/legacy-validation.service';
import { OrganizationRole } from '../src/modules/organizations/domain/organization.types';
import { ConversionType } from '../src/modules/projects/domain/project.types';

describe('LegacyValidationService GET authorization', () => {
  const userId = new Types.ObjectId().toString();
  const organizationId = new Types.ObjectId().toString();
  const projectId = new Types.ObjectId().toString();
  const screenId = new Types.ObjectId().toString();
  const jobId = new Types.ObjectId().toString();
  const job = {
    id: jobId,
    organizationId,
    projectId,
    screenId,
    conversionType: ConversionType.BMS_DSPF_TO_FRONTEND,
  };
  const run = { id: new Types.ObjectId().toString() };
  const findings = [{ id: new Types.ObjectId().toString() }];
  const organizationLookup = jest.fn();
  const organizations = { findOne: jest.fn(() => ({ exec: organizationLookup })) };
  const projects = {
    findOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ id: projectId }) })),
  };
  const screens = { collection: { findOne: jest.fn() } };
  const jobs = { findById: jest.fn() };
  const validation = { findRunByJob: jest.fn(), listFindingsByRun: jest.fn() };
  const rules = { runValidation: jest.fn() };
  const audit = { append: jest.fn() };
  const service = new LegacyValidationService(
    organizations as never,
    projects as never,
    screens as never,
    jobs as never,
    validation as never,
    rules as never,
    audit as never,
  );
  const organization = (role: OrganizationRole) => ({
    id: organizationId,
    members: [{ userId: new Types.ObjectId(userId), role }],
  });
  const get = () => service.get(userId, undefined, projectId, screenId, jobId);

  beforeEach(() => {
    jest.clearAllMocks();
    organizationLookup.mockReset().mockResolvedValue(organization(OrganizationRole.VIEWER));
    screens.collection.findOne.mockResolvedValue({ _id: new Types.ObjectId(screenId) });
    jobs.findById.mockResolvedValue(job);
    validation.findRunByJob.mockResolvedValue(null);
    validation.listFindingsByRun.mockResolvedValue(findings);
    rules.runValidation.mockResolvedValue({ run, findings });
  });

  it('denies a viewer before lazy creation without an audit event', async () => {
    await expect(get()).rejects.toBeInstanceOf(ForbiddenException);
    expect(rules.runValidation).not.toHaveBeenCalled();
    expect(audit.append).not.toHaveBeenCalled();
  });

  it.each(Object.values(OrganizationRole))(
    'preserves existing results for %s without requiring write access',
    async (role) => {
      organizationLookup.mockResolvedValue(organization(role));
      validation.findRunByJob.mockResolvedValue(run);
      await expect(get()).resolves.toEqual({ run, findings });
      expect(organizationLookup).toHaveBeenCalledTimes(1);
      expect(rules.runValidation).not.toHaveBeenCalled();
      expect(audit.append).not.toHaveBeenCalled();
    },
  );

  it.each([OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.MEMBER])(
    'preserves authorized lazy creation for %s in the resolved organization',
    async (role) => {
      organizationLookup.mockResolvedValue(organization(role));
      await expect(get()).resolves.toEqual({ run, findings });
      expect(organizations.findOne).toHaveBeenLastCalledWith({
        _id: new Types.ObjectId(organizationId),
        'members.userId': new Types.ObjectId(userId),
      });
      expect(rules.runValidation).toHaveBeenCalledTimes(1);
      expect(rules.runValidation).toHaveBeenCalledWith(job, organizationId);
    },
  );

  it.each([organization(OrganizationRole.VIEWER), null])(
    'rechecks permission immediately before persistence after a role/membership change: %p',
    async (currentOrganization) => {
      organizationLookup
        .mockResolvedValueOnce(organization(OrganizationRole.MEMBER))
        .mockResolvedValueOnce(currentOrganization);
      await expect(get()).rejects.toBeInstanceOf(ForbiddenException);
      expect(rules.runValidation).not.toHaveBeenCalled();
      expect(audit.append).not.toHaveBeenCalled();
    },
  );
});
