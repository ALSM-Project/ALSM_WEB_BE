import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AUDIT_REPOSITORY, AuditRepository } from '../../audit/domain/audit.repository';
import { OrganizationAuthorizationService } from '../../organizations/application/organization-authorization.service';
import { OrganizationContextService } from '../../organizations/application/organization-context.service';
import { OrganizationRole } from '../../organizations/domain/organization.types';
import { ProjectService } from '../../projects/application/project.service';
import {
  CONVERSION_JOB_REPOSITORY,
  CONVERSION_QUEUE,
  ConversionJobRecord,
  ConversionJobRepository,
  ConversionJobStatus,
  ConversionPriority,
  ConversionQueuePort,
} from '../domain/conversion-job.types';
import { OrganizationRecord } from '../../organizations/domain/organization.repository';
import { ProjectRecord } from '../../projects/domain/project.types';
import { SCREEN_REPOSITORY, ScreenRepository } from '../../screens/domain/screen.types';
@Injectable()
export class ConversionJobService {
  private readonly logger = new Logger(ConversionJobService.name);

  constructor(
    @Inject(CONVERSION_JOB_REPOSITORY) private readonly jobs: ConversionJobRepository,
    @Inject(CONVERSION_QUEUE) private readonly queue: ConversionQueuePort,
    private readonly projects: ProjectService,
    private readonly organizationContext: OrganizationContextService,
    private readonly authorization: OrganizationAuthorizationService,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
    @Inject(SCREEN_REPOSITORY) private readonly screens: ScreenRepository,
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
    // The screen (once one exists) is the source of truth for where its real uploaded
    // file lives — resolve inputReference from it server-side rather than trusting
    // whatever (if anything) the caller passed. This is what makes bulk conversion work:
    // the bulk endpoint only ever received one shared inputReference for the whole
    // batch (or none), which is wrong for every screen but the first.
    const screen = input.screenId
      ? await this.screens.findById(input.screenId, organization.id)
      : null;
    const inputReference = screen?.inputReference ?? input.inputReference;
    const job = await this.jobs.create({
      organizationId: organization.id,
      projectId: project.id,
      screenId: input.screenId,
      conversionType: project.conversionType,
      status: ConversionJobStatus.QUEUED,
      priority: input.priority ?? ConversionPriority.NORMAL,
      attemptCount: 0,
      maxAttempts: 3,
      inputReference,
      createdBy: userId,
    });
    // Actual execution happens asynchronously in ConversionWorkerRunner, which consumes
    // this queue entry — never inline here. Running it inline too (as a prior version of
    // this method did) raced with the worker over the same job id / working directory.
    try {
      await this.queue.enqueue(job.id, job.priority);
    } catch (error) {
      // A BadRequestException is never logged by the global exception filter (it only logs
      // unhandled 500s) — without this, an enqueue failure reaches the user with no trace
      // anywhere on the server, which is no better than the silent swallow this replaced.
      this.logger.error(`Failed to enqueue conversion job ${job.id}: ${String(error)}`);
      throw new BadRequestException({
        code: 'CONVERSION_QUEUE_UNAVAILABLE',
        message: 'Conversion job could not be queued',
        details: error instanceof Error ? [error.message] : [],
      });
    }
    await this.audit.append({
      actorUserId: userId,
      organizationId: organization.id,
      action: 'CONVERSION_JOB_CREATED',
      resourceType: 'CONVERSION_JOB',
      resourceId: job.id,
    });
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

  async retry(
    userId: string,
    organizationHeader: string | undefined,
    id: string,
  ): Promise<ConversionJobRecord> {
    const organization = await this.organizationContext.resolve(userId, organizationHeader);
    const job = await this.jobs.retry(id, organization.id);
    if (!job) throw this.notFound();
    // jobs.retry() only flips the Mongo record back to QUEUED — it was never actually
    // re-enqueued in BullMQ, so a "retried" job just sat there forever with nothing to ever
    // pick it up (same class of bug as the original create-job enqueue swallow).
    try {
      await this.queue.enqueue(job.id, job.priority);
    } catch (error) {
      this.logger.error(`Failed to re-enqueue retried conversion job ${job.id}: ${String(error)}`);
      throw new BadRequestException({
        code: 'CONVERSION_QUEUE_UNAVAILABLE',
        message: 'Conversion job could not be queued',
        details: error instanceof Error ? [error.message] : [],
      });
    }
    return job;
  }

  private notFound(): NotFoundException {
    return new NotFoundException({ code: 'JOB_NOT_FOUND', message: 'Conversion job was not found' });
  }
}
