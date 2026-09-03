import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
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
@Injectable()
export class ConversionJobService {
  constructor(
    @Inject(CONVERSION_JOB_REPOSITORY) private readonly jobs: ConversionJobRepository,
    @Inject(CONVERSION_QUEUE) private readonly queue: ConversionQueuePort,
    private readonly projects: ProjectService,
    private readonly organizationContext: OrganizationContextService,
    private readonly authorization: OrganizationAuthorizationService,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
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
    const job = await this.jobs.create({
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
    } catch (error) {
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
    const job = await this.jobs.retry(id, organization.id);
    if (!job) {
      const exists = await this.jobs.findById(id, organization.id);
      if (!exists) throw this.notFound();
      throw new BadRequestException({
        code: 'CONVERSION_JOB_NOT_RETRYABLE',
        message: 'Only failed or dead jobs can be retried',
      });
    }
    await this.queue.enqueue(job.id, job.priority);
    await this.audit.append({
      actorUserId: userId,
      organizationId: organization.id,
      action: 'CONVERSION_JOB_RETRIED',
      resourceType: 'CONVERSION_JOB',
      resourceId: id,
    });
    return job;
  }
  private notFound(): NotFoundException {
    return new NotFoundException({
      code: 'CONVERSION_JOB_NOT_FOUND',
      message: 'Conversion job was not found',
    });
  }
}
