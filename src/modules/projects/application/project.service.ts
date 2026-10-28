import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AUDIT_REPOSITORY, AuditRepository } from '../../audit/domain/audit.repository';
import { OrganizationAuthorizationService } from '../../organizations/application/organization-authorization.service';
import { OrganizationContextService } from '../../organizations/application/organization-context.service';
import { OrganizationRole } from '../../organizations/domain/organization.types';
import {
  PROJECT_REPOSITORY,
  ProjectRecord,
  ProjectRepository,
  ConversionType,
  ProjectStatus,
} from '../domain/project.types';

@Injectable()
export class ProjectService {
  constructor(
    @Inject(PROJECT_REPOSITORY) private readonly projects: ProjectRepository,
    private readonly organizationContext: OrganizationContextService,
    private readonly authorization: OrganizationAuthorizationService,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
  ) {}

  async create(
    userId: string,
    organizationHeader: string | undefined,
    input: { name: string; description?: string; conversionType: ConversionType },
  ): Promise<ProjectRecord> {
    const organization = await this.organizationContext.resolve(userId, organizationHeader);
    this.authorization.require(organization, userId, [
      OrganizationRole.OWNER,
      OrganizationRole.ADMIN,
      OrganizationRole.MEMBER,
    ]);
    const project = await this.projects.create({
      organizationId: organization.id,
      createdBy: userId,
      name: input.name,
      description: input.description,
      conversionType: input.conversionType,
      status: ProjectStatus.DRAFT,
    });
    await this.audit.append({
      actorUserId: userId,
      organizationId: organization.id,
      action: 'PROJECT_CREATED',
      resourceType: 'PROJECT',
      resourceId: project.id,
    });
    return project;
  }

  async createDemo(
    userId: string,
    organizationHeader: string | undefined,
    input?: { name?: string; description?: string },
  ): Promise<ProjectRecord> {
    const organization = await this.organizationContext.resolve(userId, organizationHeader);
    const projectName = input?.name || `ALSM Demo Banking Modernization ${new Date().toISOString().slice(0, 10)}`;
    const project = await this.projects.create({
      organizationId: organization.id,
      createdBy: userId,
      name: projectName,
      description:
        input?.description ||
        'Interactive demonstration project with pre-configured BMS screens and COBOL batch logic for customer presentations.',
      conversionType: ConversionType.BMS_DSPF_TO_FRONTEND,
      status: ProjectStatus.ACTIVE,
      isDemo: true,
    });
    await this.audit.append({
      actorUserId: userId,
      organizationId: organization.id,
      action: 'DEMO_PROJECT_CREATED',
      resourceType: 'PROJECT',
      resourceId: project.id,
    });
    return project;
  }

  async assignTeamLead(
    userId: string,
    projectId: string,
    teamLeadId: string,
  ): Promise<ProjectRecord> {
    const project = await this.projects.assignTeamLead(projectId, teamLeadId);
    if (!project) throw this.notFound();
    await this.audit.append({
      actorUserId: userId,
      organizationId: project.organizationId,
      action: 'PROJECT_ASSIGNED_TO_TEAM_LEAD',
      resourceType: 'PROJECT',
      resourceId: projectId,
      metadata: { assignedTeamLeadId: teamLeadId },
    });
    return project;
  }

  async list(
    userId: string,
    organizationHeader?: string,
    isPlatformAdmin = false,
  ): Promise<ProjectRecord[]> {
    // A Platform Admin assigns projects of any organisation to a Team Lead (UC 3.13.3), so
    // without a specific organization in the request they see every project in the system.
    if (isPlatformAdmin && !organizationHeader?.trim()) {
      return this.projects.findAll();
    }
    const organization = await this.organizationContext.resolve(userId, organizationHeader);
    const own = await this.projects.findAll(organization.id);
    // Projects a Team Lead allocated to this person belong in their list wherever they live (UC-86).
    const allocated = (await this.projects.findByAssignedStaff(userId)) ?? [];
    const known = new Set(own.map((p) => p.id));
    return [...own, ...allocated.filter((p) => !known.has(p.id))];
  }

  async get(
    userId: string,
    organizationHeader: string | undefined,
    id: string,
  ): Promise<ProjectRecord> {
    const organization = await this.organizationContext.resolve(userId, organizationHeader);
    return this.requireProject(id, organization.id);
  }

  async update(
    userId: string,
    organizationHeader: string | undefined,
    id: string,
    input: { name?: string; description?: string; status?: ProjectStatus },
  ): Promise<ProjectRecord> {
    const organization = await this.organizationContext.resolve(userId, organizationHeader);
    this.authorization.require(organization, userId, [
      OrganizationRole.OWNER,
      OrganizationRole.ADMIN,
      OrganizationRole.MEMBER,
    ]);
    const project = await this.projects.update(id, organization.id, input);
    if (!project) throw this.notFound();
    await this.audit.append({
      actorUserId: userId,
      organizationId: organization.id,
      action: 'PROJECT_UPDATED',
      resourceType: 'PROJECT',
      resourceId: id,
    });
    return project;
  }

  async remove(userId: string, organizationHeader: string | undefined, id: string): Promise<void> {
    const organization = await this.organizationContext.resolve(userId, organizationHeader);
    this.authorization.require(organization, userId, [
      OrganizationRole.OWNER,
      OrganizationRole.ADMIN,
    ]);
    if (!(await this.projects.softDelete(id, organization.id))) throw this.notFound();
    await this.audit.append({
      actorUserId: userId,
      organizationId: organization.id,
      action: 'PROJECT_DELETED',
      resourceType: 'PROJECT',
      resourceId: id,
    });
  }

  async getForOrganization(id: string, organizationId: string): Promise<ProjectRecord> {
    return this.requireProject(id, organizationId);
  }

  private async requireProject(id: string, organizationId: string): Promise<ProjectRecord> {
    const project = await this.projects.findById(id, organizationId);
    if (!project) throw this.notFound();
    return project;
  }

  private notFound(): NotFoundException {
    return new NotFoundException({ code: 'PROJECT_NOT_FOUND', message: 'Project was not found' });
  }
}
