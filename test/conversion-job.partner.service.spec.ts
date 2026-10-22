import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConversionJobService } from '../src/modules/conversions/application/conversion-job.service';
import {
  ConversionJobRepository,
  ConversionJobStatus,
  ConversionPriority,
  ConversionQueuePort,
} from '../src/modules/conversions/domain/conversion-job.types';
import { ConversionType, ProjectStatus } from '../src/modules/projects/domain/project.types';
import { ProjectService } from '../src/modules/projects/application/project.service';
import { OrganizationContextService } from '../src/modules/organizations/application/organization-context.service';
import { OrganizationAuthorizationService } from '../src/modules/organizations/application/organization-authorization.service';
import { AuditRepository } from '../src/modules/audit/domain/audit.repository';
import { ScreenRepository } from '../src/modules/screens/domain/screen.types';

const PROJECT = '6650aa00aa00aa00aa00aa01';
const SCREEN_A = '6650bb00bb00bb00bb00bb0a';
const SCREEN_B = '6650bb00bb00bb00bb00bb0b';
const SCREEN_C = '6650bb00bb00bb00bb00bb0c';

function code(error: unknown): string | undefined {
  return ((error as HttpException).getResponse() as { code?: string }).code;
}

describe('ConversionJobService - convert on behalf of partner (UC-47)', () => {
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
  const screens = { findById: jest.fn(), listByProject: jest.fn() };
  const service = new ConversionJobService(
    jobs as unknown as ConversionJobRepository,
    queue as unknown as ConversionQueuePort,
    projects as unknown as ProjectService,
    context as unknown as OrganizationContextService,
    authorization as unknown as OrganizationAuthorizationService,
    audit as unknown as AuditRepository,
    screens as unknown as ScreenRepository,
  );

  function screen(id: string, overrides: Record<string, unknown> = {}) {
    return {
      id,
      projectId: PROJECT,
      organizationId: 'org-a',
      name: `${id.slice(-1).toUpperCase()}.bms`,
      inputReference: `sources/${PROJECT}/${id}`,
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    context.resolve.mockResolvedValue({ id: 'org-a', members: [] });
    projects.getForOrganization.mockResolvedValue({
      id: PROJECT,
      conversionType: ConversionType.BMS_DSPF_TO_FRONTEND,
      status: ProjectStatus.ACTIVE,
    });
    screens.findById.mockImplementation((id: string) => Promise.resolve(screen(id)));
    jobs.listByScreen.mockResolvedValue([]);
    let n = 0;
    jobs.create.mockImplementation((input: Record<string, unknown>) =>
      Promise.resolve({ id: `job-${++n}`, ...input }),
    );
    queue.enqueue.mockResolvedValue(undefined);
    audit.append.mockResolvedValue(undefined);
  });

  describe('single item (convert / retry)', () => {
    it('queues a job using the inputReference stored on the screen, never the client value', async () => {
      const job = await service.startForPartner('staff-1', 'org-a', PROJECT, {
        screenId: SCREEN_A,
        priority: ConversionPriority.HIGH,
      });

      expect(jobs.create).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org-a',
          projectId: PROJECT,
          screenId: SCREEN_A,
          inputReference: `sources/${PROJECT}/${SCREEN_A}`,
          status: ConversionJobStatus.QUEUED,
          priority: ConversionPriority.HIGH,
          attemptCount: 0,
          maxAttempts: 3,
          createdBy: 'staff-1',
        }),
      );
      expect(queue.enqueue).toHaveBeenCalledWith(job.id, ConversionPriority.HIGH);
      expect(audit.append).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: 'staff-1',
          action: 'CONVERSION_JOB_CREATED',
          resourceType: 'CONVERSION_JOB',
          resourceId: job.id,
        }),
      );
    });

    it('returns 404 SCREEN_NOT_FOUND for a missing screen or one from another project', async () => {
      screens.findById.mockResolvedValueOnce(null);
      const missing = await service
        .startForPartner('staff-1', 'org-a', PROJECT, { screenId: SCREEN_A })
        .catch((e: unknown) => e);
      expect(missing).toBeInstanceOf(NotFoundException);
      expect(code(missing)).toBe('SCREEN_NOT_FOUND');

      screens.findById.mockResolvedValueOnce(screen(SCREEN_A, { projectId: 'other-project' }));
      await expect(
        service.startForPartner('staff-1', 'org-a', PROJECT, { screenId: SCREEN_A }),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(jobs.create).not.toHaveBeenCalled();
      expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('rejects a second trigger while a conversion is already queued or processing (409)', async () => {
      jobs.listByScreen.mockResolvedValue([
        { id: 'job-old', status: ConversionJobStatus.PROCESSING, updatedAt: new Date() },
      ]);

      const error = await service
        .startForPartner('staff-1', 'org-a', PROJECT, { screenId: SCREEN_A })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect(code(error)).toBe('CONVERSION_ALREADY_IN_PROGRESS');
      expect(jobs.create).not.toHaveBeenCalled();
    });

    it('allows a retry when the only active-looking job is stale or the last one failed', async () => {
      jobs.listByScreen.mockResolvedValue([
        {
          id: 'job-stuck',
          status: ConversionJobStatus.QUEUED,
          updatedAt: new Date(Date.now() - 60 * 60 * 1000),
        },
        { id: 'job-failed', status: ConversionJobStatus.FAILED, updatedAt: new Date() },
      ]);

      await service.startForPartner('staff-1', 'org-a', PROJECT, { screenId: SCREEN_A });

      expect(jobs.create).toHaveBeenCalledTimes(1);
    });

    it('blocks a COBOL program with missing application copybooks (422) but not one missing only DFH*', async () => {
      projects.getForOrganization.mockResolvedValue({
        id: PROJECT,
        conversionType: ConversionType.COBOL_TO_JAVA,
        status: ProjectStatus.ACTIVE,
      });
      screens.findById.mockResolvedValueOnce(
        screen(SCREEN_A, {
          name: 'CBACT01C.cbl',
          dependencyStatus: 'BLOCKED',
          dependencies: [
            { copyName: 'CVACT01Y', status: 'MISSING', message: 'CVACT01Y could not be found' },
          ],
        }),
      );
      const error = await service
        .startForPartner('staff-1', 'org-a', PROJECT, { screenId: SCREEN_A })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect(code(error)).toBe('COPYBOOK_DEPENDENCY_BLOCKED');
      expect((error as HttpException).message).toBeDefined();
      expect(jobs.create).not.toHaveBeenCalled();

      screens.findById.mockResolvedValueOnce(
        screen(SCREEN_B, {
          name: 'COSGN00C.cbl',
          dependencyStatus: 'BLOCKED',
          dependencies: [{ copyName: 'DFHAID', status: 'MISSING' }],
        }),
      );
      await service.startForPartner('staff-1', 'org-a', PROJECT, { screenId: SCREEN_B });
      expect(jobs.create).toHaveBeenCalledTimes(1);
    });

    it('marks the job FAILED and returns CONVERSION_QUEUE_UNAVAILABLE when the queue is down', async () => {
      queue.enqueue.mockRejectedValue(new Error('ECONNREFUSED redis'));

      const error = await service
        .startForPartner('staff-1', 'org-a', PROJECT, { screenId: SCREEN_A })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect(code(error)).toBe('CONVERSION_QUEUE_UNAVAILABLE');
      expect((error as HttpException).message).not.toMatch(/ECONNREFUSED/);
      expect(jobs.markFailed).toHaveBeenCalledWith(
        'job-1',
        'CONVERSION_QUEUE_UNAVAILABLE',
        'Conversion job could not be queued',
      );
      expect(audit.append).not.toHaveBeenCalled();
    });

    it('denies the action before any write when the organization role is not allowed', async () => {
      authorization.require.mockImplementationOnce(() => {
        throw new ForbiddenException({ code: 'ORGANIZATION_ACCESS_DENIED' });
      });

      await expect(
        service.startForPartner('viewer-1', 'org-a', PROJECT, { screenId: SCREEN_A }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(jobs.create).not.toHaveBeenCalled();
    });
  });

  describe('bulk ("Run All")', () => {
    it('queues one job per screen, each with its own inputReference', async () => {
      const result = await service.startBulkForPartner('staff-1', 'org-a', PROJECT, {
        screenIds: [SCREEN_A, SCREEN_B, SCREEN_C],
      });

      expect(result.skipped).toEqual([]);
      expect(result.jobs).toHaveLength(3);
      expect(jobs.create.mock.calls.map(([input]) => input.inputReference)).toEqual([
        `sources/${PROJECT}/${SCREEN_A}`,
        `sources/${PROJECT}/${SCREEN_B}`,
        `sources/${PROJECT}/${SCREEN_C}`,
      ]);
      expect(queue.enqueue).toHaveBeenCalledTimes(3);
      expect(audit.append).toHaveBeenCalledTimes(3);
    });

    it('skips screens that are missing or already running and still queues the others', async () => {
      screens.findById.mockImplementation((id: string) =>
        Promise.resolve(id === SCREEN_B ? null : screen(id)),
      );
      jobs.listByScreen.mockImplementation((_p: string, screenId: string) =>
        Promise.resolve(
          screenId === SCREEN_C
            ? [{ id: 'job-running', status: ConversionJobStatus.QUEUED, updatedAt: new Date() }]
            : [],
        ),
      );

      const result = await service.startBulkForPartner('staff-1', 'org-a', PROJECT, {
        screenIds: [SCREEN_A, SCREEN_B, SCREEN_C, SCREEN_A],
      });

      expect(result.jobs.map((j) => j.screenId)).toEqual([SCREEN_A]);
      expect(result.skipped).toEqual([
        expect.objectContaining({ screenId: SCREEN_B, code: 'SCREEN_NOT_FOUND' }),
        expect.objectContaining({ screenId: SCREEN_C, code: 'CONVERSION_ALREADY_IN_PROGRESS' }),
      ]);
    });

    it('reports the rest as skipped when the queue fails part-way, keeping jobs already queued', async () => {
      queue.enqueue.mockResolvedValueOnce(undefined).mockRejectedValue(new Error('redis down'));

      const result = await service.startBulkForPartner('staff-1', 'org-a', PROJECT, {
        screenIds: [SCREEN_A, SCREEN_B, SCREEN_C],
      });

      expect(result.jobs).toHaveLength(1);
      expect(result.skipped).toEqual([
        expect.objectContaining({ screenId: SCREEN_B, code: 'CONVERSION_QUEUE_UNAVAILABLE' }),
        expect.objectContaining({ screenId: SCREEN_C, code: 'CONVERSION_QUEUE_UNAVAILABLE' }),
      ]);
      expect(jobs.markFailed).toHaveBeenCalledTimes(1);
      expect(jobs.create).toHaveBeenCalledTimes(2);
    });

    it('fails with CONVERSION_QUEUE_UNAVAILABLE when the queue is down from the start', async () => {
      queue.enqueue.mockRejectedValue(new Error('redis down'));

      const error = await service
        .startBulkForPartner('staff-1', 'org-a', PROJECT, { screenIds: [SCREEN_A, SCREEN_B] })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect(code(error)).toBe('CONVERSION_QUEUE_UNAVAILABLE');
      expect(jobs.create).toHaveBeenCalledTimes(1);
    });
  });
});
