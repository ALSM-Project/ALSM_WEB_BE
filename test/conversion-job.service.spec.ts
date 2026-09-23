import { NotFoundException } from '@nestjs/common';
import { ConversionJobService } from '../src/modules/conversions/application/conversion-job.service';
import {
  ConversionJobRepository,
  ConversionPriority,
  ConversionJobStatus,
  ConversionQueuePort,
  ConversionEnginePort,
} from '../src/modules/conversions/domain/conversion-job.types';
import { ConversionType, ProjectStatus } from '../src/modules/projects/domain/project.types';
import { ProjectService } from '../src/modules/projects/application/project.service';
import { OrganizationContextService } from '../src/modules/organizations/application/organization-context.service';
import { OrganizationAuthorizationService } from '../src/modules/organizations/application/organization-authorization.service';
import { AuditRepository } from '../src/modules/audit/domain/audit.repository';
import { ScreenService } from '../src/modules/conversions/application/screen.service';
describe('ConversionJobService', () => {
  const jobs = {
    create: jest.fn(),
    findById: jest.fn(),
    listByProject: jest.fn(),
    listByScreen: jest.fn(),
    retry: jest.fn(),
    markProcessing: jest.fn(),
    markCompleted: jest.fn(),
    markFailed: jest.fn(),
  };
  const queue = { enqueue: jest.fn() };
  const engine = {
    execute: jest.fn().mockResolvedValue({ resultReference: 'ref-1', toolVersion: 'v1.0' }),
  };
  const projects = { getForOrganization: jest.fn() };
  const context = { resolve: jest.fn() };
  const authorization = { require: jest.fn() };
  const audit = { append: jest.fn() };
  const screens = { getScreenById: jest.fn(), updateScreenStatus: jest.fn() };
  const service = new ConversionJobService(
    jobs as unknown as ConversionJobRepository,
    queue as unknown as ConversionQueuePort,
    engine as unknown as ConversionEnginePort,
    projects as unknown as ProjectService,
    context as unknown as OrganizationContextService,
    authorization as unknown as OrganizationAuthorizationService,
    audit as unknown as AuditRepository,
    screens as unknown as ScreenService,
  );
  beforeEach(() => {
    jest.clearAllMocks();
    context.resolve.mockResolvedValue({ id: 'org-a', members: [] });
    projects.getForOrganization.mockResolvedValue({
      id: 'p1',
      conversionType: ConversionType.BMS_DSPF_TO_FRONTEND,
      status: ProjectStatus.DRAFT,
    });
    jobs.create.mockResolvedValue({ id: 'job-1', priority: ConversionPriority.NORMAL });
  });
  it('persists and enqueues only a conversion job id', async () => {
    await service.create('u1', 'org-a', 'p1', {});
    expect(jobs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-a',
        projectId: 'p1',
        status: ConversionJobStatus.QUEUED,
      }),
    );
    expect(queue.enqueue).toHaveBeenCalledWith('job-1', ConversionPriority.NORMAL);
  });
  it('rejects retry for a job that is not failed or dead', async () => {
    jobs.retry.mockResolvedValue(null);
    jobs.findById.mockResolvedValue({ id: 'job-1' });
    await expect(service.retry('u1', 'org-a', 'job-1')).rejects.toBeInstanceOf(NotFoundException);
  });
  it('creates one job per screen for a bulk conversion request', async () => {
    jobs.create
      .mockResolvedValueOnce({ id: 'job-1', priority: ConversionPriority.NORMAL })
      .mockResolvedValueOnce({ id: 'job-2', priority: ConversionPriority.NORMAL });
    const result = await service.createBulk('u1', 'org-a', 'p1', {
      screenIds: ['scr-login', 'scr-dashboard'],
    });
    expect(result).toHaveLength(2);
    expect(jobs.create).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p1', screenId: 'scr-login' }),
    );
    expect(jobs.create).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p1', screenId: 'scr-dashboard' }),
    );
    expect(queue.enqueue).toHaveBeenNthCalledWith(1, 'job-1', ConversionPriority.NORMAL);
    expect(queue.enqueue).toHaveBeenNthCalledWith(2, 'job-2', ConversionPriority.NORMAL);
  });
  it('scopes listByScreen to the resolved organization and project', async () => {
    jobs.listByScreen.mockResolvedValue([{ id: 'job-1', screenId: 'scr-login' }]);
    const result = await service.listByScreen('u1', 'org-a', 'p1', 'scr-login');
    expect(result).toEqual([{ id: 'job-1', screenId: 'scr-login' }]);
    expect(jobs.listByScreen).toHaveBeenCalledWith('p1', 'scr-login', 'org-a');
  });
});
