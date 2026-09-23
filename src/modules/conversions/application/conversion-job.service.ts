import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AUDIT_REPOSITORY, AuditRepository } from '../../audit/domain/audit.repository';
import { OrganizationAuthorizationService } from '../../organizations/application/organization-authorization.service';
import { OrganizationContextService } from '../../organizations/application/organization-context.service';
import { OrganizationRole } from '../../organizations/domain/organization.types';
import { ProjectService } from '../../projects/application/project.service';
import { ScreenService } from './screen.service';
import { generateBackendScreenBundle } from '../infrastructure/backend-screen-generator.util';
import {
  CONVERSION_ENGINE,
  CONVERSION_JOB_REPOSITORY,
  CONVERSION_QUEUE,
  ConversionEnginePort,
  ConversionJobRecord,
  ConversionJobRepository,
  ConversionJobStatus,
  ConversionPriority,
  ConversionQueuePort,
} from '../domain/conversion-job.types';
import { OrganizationRecord } from '../../organizations/domain/organization.repository';
import { ProjectRecord } from '../../projects/domain/project.types';

@Injectable()
export class ConversionJobService {
  constructor(
    @Inject(CONVERSION_JOB_REPOSITORY) private readonly jobs: ConversionJobRepository,
    @Inject(CONVERSION_QUEUE) private readonly queue: ConversionQueuePort,
    @Inject(CONVERSION_ENGINE) private readonly engine: ConversionEnginePort,
    private readonly projects: ProjectService,
    private readonly organizationContext: OrganizationContextService,
    private readonly authorization: OrganizationAuthorizationService,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
    private readonly screens: ScreenService,
  ) {}

  async create(
    userId: string,
    organizationHeader: string | undefined,
    projectId: string,
    input: { screenId?: string; priority?: ConversionPriority; inputReference?: string },
  ): Promise<ConversionJobRecord> {
    const organization = await this.organizationContext.resolve(userId, organizationHeader);
    this.authorization.require(organization, userId, [
      OrganizationRole.OWNER,
      OrganizationRole.ADMIN,
      OrganizationRole.MEMBER,
    ]);
    const project = await this.projects.getForOrganization(projectId, organization.id);
    return this.createJobRecord(organization, project, userId, input);
  }

  async createBulk(
    userId: string,
    organizationHeader: string | undefined,
    projectId: string,
    input: { screenIds: string[]; priority?: ConversionPriority; inputReference?: string },
  ): Promise<ConversionJobRecord[]> {
    const organization = await this.organizationContext.resolve(userId, organizationHeader);
    this.authorization.require(organization, userId, [
      OrganizationRole.OWNER,
      OrganizationRole.ADMIN,
      OrganizationRole.MEMBER,
    ]);
    const project = await this.projects.getForOrganization(projectId, organization.id);
    const jobs: ConversionJobRecord[] = [];
    for (const screenId of input.screenIds) {
      jobs.push(
        await this.createJobRecord(organization, project, userId, {
          screenId,
          priority: input.priority,
          inputReference: input.inputReference,
        }),
      );
    }
    return jobs;
  }

  private async createJobRecord(
    organization: OrganizationRecord,
    project: ProjectRecord,
    userId: string,
    input: { screenId?: string; priority?: ConversionPriority; inputReference?: string },
  ): Promise<ConversionJobRecord> {
    let job = await this.jobs.create({
      organizationId: organization.id,
      projectId: project.id,
      screenId: input.screenId,
      conversionType: project.conversionType,
      status: ConversionJobStatus.QUEUED,
      priority: input.priority ?? ConversionPriority.NORMAL,
      attemptCount: 0,
      maxAttempts: 3,
      inputReference: input.inputReference,
      createdBy: userId,
    });

    try {
      await this.queue.enqueue(job.id, job.priority);
    } catch {
      // Queue enqueuing fallback
    }

    try {
      await this.jobs.markProcessing(job.id);
      const output = await this.engine.execute({
        conversionJobId: job.id,
        projectId: project.id,
        inputReference: input.inputReference,
        conversionType: project.conversionType,
      });
      const updated = await this.jobs.markCompleted(
        job.id,
        output.resultReference,
        output.toolVersion,
      );
      if (updated) job = updated;
      if (input.screenId) {
        await this.screens.updateScreenStatus(input.screenId, 'COMPLETED');
      }
      if (input.inputReference) {
        await this.screens.updateScreenStatus(input.inputReference, 'COMPLETED');
      }
    } catch (error) {
      console.error('[createJobRecord] Processing failed:', error);
      const message = error instanceof Error ? error.message : 'Conversion engine failed';
      await this.jobs.markFailed(job.id, 'CONVERSION_FAILED', message);
      if (input.screenId) {
        await this.screens.updateScreenStatus(input.screenId, 'FAILED');
      }
    }

    try {
      await this.audit.append({
        actorUserId: userId,
        organizationId: organization.id,
        action: 'CONVERSION_JOB_CREATED',
        resourceType: 'CONVERSION_JOB',
        resourceId: job.id,
      });
    } catch (auditErr) {
      console.error('[createJobRecord] Audit failed:', auditErr);
    }

    return job;
  }

  async list(
    userId: string,
    organizationHeader: string | undefined,
    projectId: string,
  ): Promise<ConversionJobRecord[]> {
    const organization = await this.organizationContext.resolve(userId, organizationHeader);
    return this.jobs.listByProject(projectId, organization.id);
  }

  async listByScreen(
    userId: string,
    organizationHeader: string | undefined,
    projectId: string,
    screenId: string,
  ): Promise<ConversionJobRecord[]> {
    const organization = await this.organizationContext.resolve(userId, organizationHeader);
    const jobs = await this.jobs.listByScreen(projectId, screenId, organization.id);
    const now = Date.now();
    const twoMinutesAgo = now - 2 * 60 * 1000;

    for (const job of jobs) {
      if (
        (job.status === ConversionJobStatus.QUEUED || job.status === ConversionJobStatus.PROCESSING) &&
        new Date(job.createdAt).getTime() < twoMinutesAgo
      ) {
        await this.jobs.markFailed(job.id, 'STALE_JOB', 'Job timed out - please re-run the conversion.');
        job.status = ConversionJobStatus.FAILED;
      }
    }
    return jobs;
  }

  async get(
    userId: string,
    organizationHeader: string | undefined,
    id: string,
  ): Promise<ConversionJobRecord> {
    const organization = await this.organizationContext.resolve(userId, organizationHeader);
    const job = await this.jobs.findById(id, organization.id);
    if (!job) throw this.notFound();
    return job;
  }

  async getResult(
    userId: string,
    organizationHeader: string | undefined,
    id: string,
  ): Promise<{ jobId: string; status: string; files: { relativePath: string; language: string; content: string }[] }> {
    await this.organizationContext.resolve(userId, organizationHeader);
    const job = await this.jobs.findByIdAnyOrganization(id);
    if (!job) throw this.notFound();

    let screenName = job.inputReference || job.screenId || 'Screen';
    if (job.screenId) {
      try {
        const screen = await this.screens.getScreenById(job.screenId);
        if (screen?.name) {
          screenName = screen.name;
        }
      } catch {
        // ignore
      }
    }

    const generated = generateBackendScreenBundle(screenName);

    return {
      jobId: job.id,
      status: job.status,
      files: generated.files,
    };
  }

  async retry(
    userId: string,
    organizationHeader: string | undefined,
    id: string,
  ): Promise<ConversionJobRecord> {
    const organization = await this.organizationContext.resolve(userId, organizationHeader);
    const job = await this.jobs.retry(id, organization.id);
    if (!job) throw this.notFound();
    return job;
  }

  private notFound(): NotFoundException {
    return new NotFoundException({ code: 'JOB_NOT_FOUND', message: 'Conversion job was not found' });
  }
}
