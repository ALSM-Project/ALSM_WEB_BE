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
    if (input.screenId && (!screen || screen.projectId !== project.id)) {
      throw new NotFoundException({ code: 'SCREEN_NOT_FOUND', message: 'Screen was not found' });
    }
    const inputReference = screen ? screen.inputReference : input.inputReference;
    if (!screen) await this.requireSourceAccess(organization.id, project.id, inputReference);
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
      await this.jobs.markFailed(
        job.id,
        'CONVERSION_QUEUE_UNAVAILABLE',
        'Conversion job could not be queued',
      );
      // A BadRequestException is never logged by the global exception filter (it only logs
      // unhandled 500s) — without this, an enqueue failure reaches the user with no trace
      // anywhere on the server, which is no better than the silent swallow this replaced.
      this.logger.error(`Failed to enqueue conversion job ${job.id}: ${String(error)}`);
      throw new BadRequestException({
        code: 'CONVERSION_QUEUE_UNAVAILABLE',
        message: 'Conversion job could not be queued',
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
    await this.projects.getForOrganization(projectId, organization.id);
    return this.jobs.listByProject(projectId, organization.id);
  }

  async listByScreen(
    userId: string,
    organizationHeader: string | undefined,
    projectId: string,
    screenId: string,
  ): Promise<ConversionJobRecord[]> {
    const organization = await this.organizationContext.resolve(userId, organizationHeader);
    await this.projects.getForOrganization(projectId, organization.id);
    return this.jobs.listByScreen(projectId, screenId, organization.id);
  }

  async get(
    userId: string,
    organizationHeader: string | undefined,
    id: string,
  ): Promise<ConversionJobRecord> {
    const organization = await this.organizationContext.resolve(userId, organizationHeader);
    const job = await this.jobs.findById(id, organization.id);
    if (!job) throw this.notFound();
    await this.projects.getForOrganization(job.projectId, organization.id);
    return job;
  }

  async retry(
    userId: string,
    organizationHeader: string | undefined,
    id: string,
  ): Promise<ConversionJobRecord> {
    const organization = await this.organizationContext.resolve(userId, organizationHeader);
    this.authorization.require(organization, userId, [
      OrganizationRole.OWNER,
      OrganizationRole.ADMIN,
      OrganizationRole.MEMBER,
    ]);
    const existing = await this.jobs.findById(id, organization.id);
    if (!existing) throw this.notFound();
    await this.projects.getForOrganization(existing.projectId, organization.id);
    await this.requireSourceAccess(
      organization.id,
      existing.projectId,
      existing.inputReference,
      existing.screenId,
    );
    const job = await this.jobs.retry(id, organization.id);
    if (!job) throw this.notFound();
    // jobs.retry() only flips the Mongo record back to QUEUED — it was never actually
    // re-enqueued in BullMQ, so a "retried" job just sat there forever with nothing to ever
    // pick it up (same class of bug as the original create-job enqueue swallow).
    try {
      await this.queue.enqueue(job.id, job.priority, job.executionGeneration ?? 0);
    } catch (error) {
      await this.jobs.markFailed(
        job.id,
        'CONVERSION_QUEUE_UNAVAILABLE',
        'Conversion job could not be queued',
      );
      this.logger.error(`Failed to re-enqueue retried conversion job ${job.id}: ${String(error)}`);
      throw new BadRequestException({
        code: 'CONVERSION_QUEUE_UNAVAILABLE',
        message: 'Conversion job could not be queued',
      });
    }
    await this.audit.append({
      actorUserId: userId,
      organizationId: organization.id,
      action: 'CONVERSION_JOB_RETRIED',
      resourceType: 'CONVERSION_JOB',
      resourceId: job.id,
    });
    return job;
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: 'JOB_NOT_FOUND',
      message: 'Conversion job was not found',
    });
  }

  private async requireSourceAccess(
    organizationId: string,
    projectId: string,
    inputReference: string | undefined,
    screenId?: string,
  ): Promise<void> {
    if (!inputReference) return;
    const candidates = screenId
      ? [await this.screens.findById(screenId, organizationId)]
      : await this.screens.listByProject(projectId, organizationId);
    if (
      !candidates.some(
        (screen) =>
          screen?.projectId === projectId &&
          screen.organizationId === organizationId &&
          screen.inputReference === inputReference,
      )
    ) {
      throw new BadRequestException({
        code: 'CONVERSION_SOURCE_NOT_ACCESSIBLE',
        message: 'Conversion source is not available in this project',
      });
    }
  }
}
