import { NotFoundException } from '@nestjs/common';
import { ConversionJobService } from '../src/modules/conversions/application/conversion-job.service';
import {
  ConversionJobRepository,
  ConversionPriority,
  ConversionJobStatus,
  ConversionQueuePort,
} from '../src/modules/conversions/domain/conversion-job.types';
import { ConversionType, ProjectStatus } from '../src/modules/projects/domain/project.types';
import { ProjectService } from '../src/modules/projects/application/project.service';
import { OrganizationContextService } from '../src/modules/organizations/application/organization-context.service';
import { OrganizationAuthorizationService } from '../src/modules/organizations/application/organization-authorization.service';
import { AuditRepository } from '../src/modules/audit/domain/audit.repository';
import { ScreenRepository } from '../src/modules/screens/domain/screen.types';
import { ConversionProjectAccessService } from '../src/modules/conversions/application/conversion-project-access.service';
describe('ConversionJobService', () => {
  const jobs = {
    create: jest.fn(),
    findById: jest.fn(),
    listByProject: jest.fn(),
    listByScreen: jest.fn(),
    retry: jest.fn(),
    markFailed: jest.fn(),
  };
  const queue = { enqueue: jest.fn() };
  const projects = { getForOrganization: jest.fn() };
  const context = { resolve: jest.fn() };
  const authorization = { require: jest.fn() };
  const audit = { append: jest.fn() };
  const screens = {
    findById: jest.fn(),
    listByProject: jest.fn(),
    create: jest.fn(),
    updateStatus: jest.fn(),
  };
  const service = new ConversionJobService(
    jobs as unknown as ConversionJobRepository,
    queue as unknown as ConversionQueuePort,
    projects as unknown as ProjectService,
    context as unknown as OrganizationContextService,
    authorization as unknown as OrganizationAuthorizationService,
    audit as unknown as AuditRepository,
    screens as unknown as ScreenRepository,
    { requireAssignment: jest.fn() } as unknown as ConversionProjectAccessService,
  );
  beforeEach(() => {
    jest.clearAllMocks();
    queue.enqueue.mockResolvedValue(undefined);
    context.resolve.mockResolvedValue({ id: 'org-a', members: [] });
    projects.getForOrganization.mockResolvedValue({
      id: 'p1',
      conversionType: ConversionType.BMS_DSPF_TO_FRONTEND,
      status: ProjectStatus.DRAFT,
    });
    jobs.create.mockResolvedValue({ id: 'job-1', priority: ConversionPriority.NORMAL });
    screens.findById.mockImplementation((id: string) => Promise.resolve({ id, projectId: 'p1' }));
    screens.listByProject.mockResolvedValue([]);
    jobs.findById.mockResolvedValue({ id: 'job-1', projectId: 'p1' });
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
  // UC-101 regression test. Bug: jobs.retry() only flipped the Mongo status back to QUEUED
  // — nothing ever pushed the job back into BullMQ, so a "retried" job just sat there
  // forever with no worker ever seeing it, exactly like the original silent enqueue bug.
  it('re-enqueues the job in BullMQ after flipping it back to QUEUED', async () => {
    jobs.retry.mockResolvedValue({ id: 'job-1', priority: ConversionPriority.HIGH });

    await service.retry('u1', 'org-a', 'job-1');

    expect(queue.enqueue).toHaveBeenCalledWith('job-1', ConversionPriority.HIGH, 0);
  });
  it('surfaces a real error instead of a silently stuck job when re-enqueuing a retry fails', async () => {
    jobs.retry.mockResolvedValue({ id: 'job-1', priority: ConversionPriority.NORMAL });
    queue.enqueue.mockRejectedValue(new Error('Redis unavailable'));

    await expect(service.retry('u1', 'org-a', 'job-1')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CONVERSION_QUEUE_UNAVAILABLE' }),
    });
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
  it("resolves each screen's own inputReference for bulk conversion instead of one shared value", async () => {
    // Regression test for the bug where every job in a bulk request ended up with
    // the same (usually missing) inputReference, since the bulk DTO only ever
    // carried one shared value for the whole batch.
    screens.findById.mockImplementation((screenId: string) =>
      Promise.resolve(
        screenId === 'scr-login'
          ? { id: 'scr-login', projectId: 'p1', inputReference: 'sources/p1/login-abc' }
          : { id: 'scr-dashboard', projectId: 'p1', inputReference: 'sources/p1/dashboard-xyz' },
      ),
    );
    jobs.create
      .mockResolvedValueOnce({ id: 'job-1', priority: ConversionPriority.NORMAL })
      .mockResolvedValueOnce({ id: 'job-2', priority: ConversionPriority.NORMAL });

    await service.createBulk('u1', 'org-a', 'p1', { screenIds: ['scr-login', 'scr-dashboard'] });

    expect(jobs.create).toHaveBeenCalledWith(
      expect.objectContaining({ screenId: 'scr-login', inputReference: 'sources/p1/login-abc' }),
    );
    expect(jobs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        screenId: 'scr-dashboard',
        inputReference: 'sources/p1/dashboard-xyz',
      }),
    );
  });
  it('scopes listByScreen to the resolved organization and project', async () => {
    jobs.listByScreen.mockResolvedValue([{ id: 'job-1', screenId: 'scr-login' }]);
    const result = await service.listByScreen('u1', 'org-a', 'p1', 'scr-login');
    expect(result).toEqual([{ id: 'job-1', screenId: 'scr-login' }]);
    expect(jobs.listByScreen).toHaveBeenCalledWith('p1', 'scr-login', 'org-a');
  });
  it('rejects a screen from another project before persisting or enqueueing', async () => {
    screens.findById.mockResolvedValue({ id: 'screen-b', projectId: 'project-b' });
    await expect(
      service.create('u1', 'org-a', 'p1', { screenId: 'screen-b' }),
    ).rejects.toMatchObject({
      response: { code: 'SCREEN_NOT_FOUND', message: 'Screen was not found' },
    });
    expect(jobs.create).not.toHaveBeenCalled();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });
  it('does not mutate old processing jobs from a screen history read', async () => {
    jobs.listByScreen.mockResolvedValue([
      { id: 'old', status: ConversionJobStatus.PROCESSING, createdAt: new Date(0) },
    ]);
    const result = await service.listByScreen('u1', 'org-a', 'p1', 'screen-1');
    expect(result[0].status).toBe(ConversionJobStatus.PROCESSING);
    expect(jobs.markFailed).not.toHaveBeenCalled();
  });
  it('denies retries before writes when organization role is read-only', async () => {
    authorization.require.mockImplementationOnce(() => {
      throw new Error('Forbidden');
    });
    await expect(service.retry('viewer', 'org-a', 'job-1')).rejects.toThrow('Forbidden');
    expect(jobs.retry).not.toHaveBeenCalled();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });
  it('marks an enqueue failure persistently instead of leaving an unreachable queued job', async () => {
    queue.enqueue.mockRejectedValueOnce(new Error('Redis unavailable'));
    await expect(service.create('u1', 'org-a', 'p1', {})).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CONVERSION_QUEUE_UNAVAILABLE' }),
    });
    expect(jobs.markFailed).toHaveBeenCalledWith(
      'job-1',
      'CONVERSION_QUEUE_UNAVAILABLE',
      expect.any(String),
    );
  });
  it.each(['org-b/secret-source', 'project-b/source', '../org-b/source'])(
    'rejects an unowned client source reference %s',
    async (inputReference) => {
      await expect(service.create('u1', 'org-a', 'p1', { inputReference })).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'CONVERSION_SOURCE_NOT_ACCESSIBLE' }),
      });
      expect(screens.listByProject).toHaveBeenCalledWith('p1', 'org-a');
      expect(jobs.create).not.toHaveBeenCalled();
    },
  );
  it('accepts only an exact reference backed by a persisted screen in the active project', async () => {
    screens.listByProject.mockResolvedValue([
      { id: 's1', projectId: 'p1', organizationId: 'org-a', inputReference: 'owned-source' },
    ]);
    await service.create('u1', 'org-a', 'p1', { inputReference: 'owned-source' });
    expect(jobs.create).toHaveBeenCalledWith(
      expect.objectContaining({ inputReference: 'owned-source' }),
    );
  });
  it('denies retry of a legacy job carrying an unowned source reference', async () => {
    jobs.findById.mockResolvedValue({
      id: 'job-1',
      projectId: 'p1',
      inputReference: 'org-b/private',
    });
    await expect(service.retry('u1', 'org-a', 'job-1')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CONVERSION_SOURCE_NOT_ACCESSIBLE' }),
    });
    expect(jobs.retry).not.toHaveBeenCalled();
  });
  it('denies retry when the persisted screen source differs from the legacy job reference', async () => {
    jobs.findById.mockResolvedValue({
      id: 'job-1',
      projectId: 'p1',
      screenId: 's1',
      inputReference: 'old-source',
    });
    screens.findById.mockResolvedValue({
      id: 's1',
      projectId: 'p1',
      organizationId: 'org-a',
      inputReference: 'new-source',
    });
    await expect(service.retry('u1', 'org-a', 'job-1')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CONVERSION_SOURCE_NOT_ACCESSIBLE' }),
    });
    expect(jobs.retry).not.toHaveBeenCalled();
  });
});
