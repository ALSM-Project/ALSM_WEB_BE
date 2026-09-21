import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ValidationReadService } from '../src/modules/validation/application/validation-read.service';
import { ConversionJobRepository } from '../src/modules/conversions/domain/conversion-job.types';
import { OrganizationContextService } from '../src/modules/organizations/application/organization-context.service';
import { ProjectService } from '../src/modules/projects/application/project.service';
import { ValidationFindingRepository } from '../src/modules/validation/domain/validation-finding.repository';
import { ValidationRunRepository } from '../src/modules/validation/domain/validation-run.repository';
import { ValidationRunStatus } from '../src/modules/validation/domain/validation-run.types';

describe('ValidationReadService tenant isolation', () => {
  const validationRuns = { findById: jest.fn(), listByConversionJob: jest.fn() };
  const validationFindings = { listByRun: jest.fn() };
  const conversionJobs = { findById: jest.fn() };
  const organizationContext = { resolve: jest.fn() };
  const projects = { getForOrganization: jest.fn() };
  const service = new ValidationReadService(
    validationRuns as unknown as ValidationRunRepository,
    validationFindings as unknown as ValidationFindingRepository,
    conversionJobs as unknown as ConversionJobRepository,
    organizationContext as unknown as OrganizationContextService,
    projects as unknown as ProjectService,
  );
  const run = {
    id: 'run-1',
    organizationId: 'org-1',
    projectId: 'project-1',
    conversionJobId: 'job-1',
    status: ValidationRunStatus.COMPLETED,
    ruleValidationEnabled: true,
    aiValidationEnabled: false,
    findingCount: 1,
    createdAt: new Date('2026-09-20T00:00:00.000Z'),
    updatedAt: new Date('2026-09-20T00:01:00.000Z'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    organizationContext.resolve.mockResolvedValue({ id: 'org-1' });
    projects.getForOrganization.mockResolvedValue({ id: 'project-1', organizationId: 'org-1' });
    conversionJobs.findById.mockResolvedValue({
      id: 'job-1',
      projectId: 'project-1',
      organizationId: 'org-1',
    });
    validationRuns.findById.mockResolvedValue(run);
    validationRuns.listByConversionJob.mockResolvedValue([run]);
    validationFindings.listByRun.mockResolvedValue([{ id: 'finding-1' }]);
  });

  it('checks the conversion relationship before listing tenant-scoped runs', async () => {
    await expect(service.listRuns('user-1', 'org-1', 'project-1', 'job-1')).resolves.toEqual([run]);

    expect(projects.getForOrganization).toHaveBeenCalledWith('project-1', 'org-1');
    expect(conversionJobs.findById).toHaveBeenCalledWith('job-1', 'org-1');
    expect(validationRuns.listByConversionJob).toHaveBeenCalledWith('job-1', 'project-1', 'org-1');
  });

  it('rejects run listing when the conversion belongs to another project', async () => {
    conversionJobs.findById.mockResolvedValue({
      id: 'job-1',
      projectId: 'project-2',
      organizationId: 'org-1',
    });

    await expect(service.listRuns('user-1', 'org-1', 'project-1', 'job-1')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'VALIDATION_CONVERSION_NOT_FOUND' }),
    });
    expect(validationRuns.listByConversionJob).not.toHaveBeenCalled();
  });

  it('rejects a validation run guessed from another organization', async () => {
    organizationContext.resolve.mockResolvedValue({ id: 'org-2' });
    projects.getForOrganization.mockResolvedValue({ id: 'project-1', organizationId: 'org-2' });
    validationRuns.findById.mockResolvedValue(null);

    await expect(service.getRun('user-2', 'org-2', 'project-1', 'run-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(validationRuns.findById).toHaveBeenCalledWith('run-1', 'project-1', 'org-2');
  });

  it('stops before repository access when the user cannot resolve the organization', async () => {
    organizationContext.resolve.mockRejectedValue(
      new ForbiddenException({ code: 'ORGANIZATION_ACCESS_DENIED' }),
    );

    await expect(service.getRun('user-2', 'org-1', 'project-1', 'run-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(projects.getForOrganization).not.toHaveBeenCalled();
    expect(validationRuns.findById).not.toHaveBeenCalled();
  });

  it('stops before run lookup when the project is outside the organization', async () => {
    projects.getForOrganization.mockRejectedValue(
      new NotFoundException({ code: 'PROJECT_NOT_FOUND' }),
    );

    await expect(service.getRun('user-1', 'org-1', 'project-2', 'run-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(validationRuns.findById).not.toHaveBeenCalled();
  });

  it('requires a tenant-scoped run before listing tenant-scoped findings', async () => {
    await expect(service.listFindings('user-1', 'org-1', 'project-1', 'run-1')).resolves.toEqual([
      { id: 'finding-1' },
    ]);

    expect(validationRuns.findById).toHaveBeenCalledWith('run-1', 'project-1', 'org-1');
    expect(validationFindings.listByRun).toHaveBeenCalledWith('run-1', 'project-1', 'org-1');
  });

  it('does not list findings when a guessed run id is outside the tenant scope', async () => {
    validationRuns.findById.mockResolvedValue(null);

    await expect(
      service.listFindings('user-1', 'org-1', 'project-1', 'run-other-tenant'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'VALIDATION_RUN_NOT_FOUND' }),
    });
    expect(validationFindings.listByRun).not.toHaveBeenCalled();
  });

  it('rejects a mismatched run record even if a repository returns one', async () => {
    validationRuns.findById.mockResolvedValue({ ...run, organizationId: 'org-2' });

    await expect(service.getRun('user-1', 'org-1', 'project-1', 'run-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
