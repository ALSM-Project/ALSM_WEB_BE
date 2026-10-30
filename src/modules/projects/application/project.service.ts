import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AUDIT_REPOSITORY, AuditRepository } from '../../audit/domain/audit.repository';
import { OrganizationAuthorizationService } from '../../organizations/application/organization-authorization.service';
import { OrganizationContextService } from '../../organizations/application/organization-context.service';
import { OrganizationRole } from '../../organizations/domain/organization.types';
import { RbacService } from '../../rbac/application/rbac.service';
import { WorkforceService } from '../../workforce/application/workforce.service';
import {
  ConversionType,
  MANAGED_PROJECT_STAGE_ORDER,
  ManagedProjectStage,
  PROJECT_REPOSITORY,
  ProjectRecord,
  ProjectRepository,
  ProjectStatus,
} from '../domain/project.types';

@Injectable()
export class ProjectService {
  constructor(
    @Inject(PROJECT_REPOSITORY) private readonly projects: ProjectRepository,
    private readonly organizationContext: OrganizationContextService,
    private readonly authorization: OrganizationAuthorizationService,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
    private readonly workforce: WorkforceService,
    private readonly rbac: RbacService,
  ) {}

  async create(
    userId: string,
    organizationHeader: string | undefined,
    input: {
      name: string;
      description?: string;
      conversionType: ConversionType;
      serviceType?: 'SELF_SERVICE' | 'MANAGED';
      contractNumber?: string;
      contractId?: string;
      businessRequirements?: string;
    },
  ): Promise<ProjectRecord> {
    const organization = await this.organizationContext.resolve(userId, organizationHeader);
    this.authorization.require(organization, userId, [
      OrganizationRole.OWNER,
      OrganizationRole.ADMIN,
      OrganizationRole.MEMBER,
    ]);

    const isManaged = input.serviceType === 'MANAGED';
    const project = await this.projects.create({
      organizationId: organization.id,
      createdBy: userId,
      name: input.name,
      description: input.description,
      conversionType: input.conversionType,
      serviceType: input.serviceType || 'SELF_SERVICE',
      status: isManaged ? ProjectStatus.SUBMITTED : ProjectStatus.DRAFT,
      contractNumber: input.contractNumber,
      contractId: input.contractId,
      currentStage: isManaged ? ManagedProjectStage.REQUIREMENTS_GATHERING : undefined,
      stageIndex: isManaged ? 1 : undefined,
      progressPct: isManaged ? 11 : undefined,
      submittedAt: isManaged ? new Date() : undefined,
      submittedBy: isManaged ? userId : undefined,
      businessRequirements: input.businessRequirements,
    });

    await this.audit.append({
      actorUserId: userId,
      organizationId: organization.id,
      action: isManaged ? 'MANAGED_PROJECT_SUBMITTED' : 'PROJECT_CREATED',
      resourceType: 'PROJECT',
      resourceId: project.id,
      metadata: {
        projectName: project.name,
        conversionType: project.conversionType,
        serviceType: project.serviceType || 'SELF_SERVICE',
        status: project.status,
      },
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

  async listAssignableTeamLeads(): Promise<
    Array<{ id: string; fullName: string; email: string; role: string; activeWorkload: number }>
  > {
    const [internalStaff, projects] = await Promise.all([
      this.workforce.getInternalEmployees(),
      this.projects.findAll(),
    ]);

    const workload = new Map<string, number>();
    for (const project of projects) {
      if (project.status === ProjectStatus.COMPLETED || !project.assignedTeamLeadId) continue;
      workload.set(project.assignedTeamLeadId, (workload.get(project.assignedTeamLeadId) ?? 0) + 1);
    }

    return internalStaff
      .filter((emp) => emp.status === 'ACTIVE')
      .map((emp) => ({
        id: emp.userId,
        fullName: emp.fullName || emp.email,
        email: emp.email,
        role: emp.role || 'Team Lead',
        activeWorkload: workload.get(emp.userId) ?? 0,
      }))
      .sort((a, b) => a.activeWorkload - b.activeWorkload || a.fullName.localeCompare(b.fullName));
  }

  async assignTeamLead(
    userId: string,
    projectId: string,
    teamLeadId: string,
    note?: string,
  ): Promise<ProjectRecord> {
    // 1. Strict constraint: team lead must be an active ALSM internal Web2 employee
    await this.workforce.validateInternalEmployee(teamLeadId);

    // 2. Lookup team lead & assigning admin details
    const allUsers = await this.rbac.getAllUsers();
    const teamLeadUser = allUsers.find((u) => u.id === teamLeadId);
    const adminUser = allUsers.find((u) => u.id === userId);

    const project = await this.projects.assignTeamLead(projectId, {
      teamLeadId,
      teamLeadName: teamLeadUser?.fullName || teamLeadUser?.email || 'Team Lead',
      assignedBy: userId,
      assignedByName: adminUser?.fullName || adminUser?.email || 'Platform Admin',
      note: note || '',
    });
    if (!project) throw this.notFound();

    await this.audit.append({
      actorUserId: userId,
      organizationId: project.organizationId,
      action: 'PROJECT_ASSIGNED_TO_TEAM_LEAD',
      resourceType: 'PROJECT',
      resourceId: projectId,
      metadata: {
        assignedTeamLeadId: teamLeadId,
        assignedTeamLeadName: teamLeadUser?.fullName || teamLeadUser?.email || '',
        note: note || '',
        status: project.status,
        currentStage: project.currentStage || '',
      },
    });

    return project;
  }

  async updateStage(
    userId: string,
    projectId: string,
    targetStage: ManagedProjectStage,
    note?: string,
  ): Promise<ProjectRecord> {
    const existing = await this.projects.findById(projectId);
    if (!existing) throw this.notFound();

    const stageIdx = MANAGED_PROJECT_STAGE_ORDER.indexOf(targetStage);
    if (stageIdx === -1) {
      throw new BadRequestException(`Invalid managed project stage: ${targetStage}`);
    }
    const stageNumber = stageIdx + 1;
    const progressPct = Math.round((stageNumber / 9) * 100);

    let statusUpdate: ProjectStatus | undefined = undefined;
    if (targetStage === ManagedProjectStage.CUSTOMER_REVIEW) {
      statusUpdate = ProjectStatus.AWAITING_CUSTOMER_REVIEW;
    } else if (targetStage === ManagedProjectStage.ACCEPTANCE) {
      statusUpdate = ProjectStatus.AWAITING_ACCEPTANCE;
    } else if (targetStage === ManagedProjectStage.DELIVERY) {
      statusUpdate = ProjectStatus.COMPLETED;
    } else if (
      existing.status === ProjectStatus.APPROVED ||
      existing.status === ProjectStatus.READY_FOR_ASSIGNMENT
    ) {
      statusUpdate = ProjectStatus.IN_PROGRESS;
    }

    const updated = await this.projects.updateStage(
      projectId,
      targetStage,
      stageNumber,
      progressPct,
      statusUpdate,
    );
    if (!updated) throw this.notFound();

    await this.audit.append({
      actorUserId: userId,
      organizationId: existing.organizationId,
      action: 'PROJECT_STAGE_UPDATED',
      resourceType: 'PROJECT',
      resourceId: projectId,
      metadata: {
        previousStage: existing.currentStage || '',
        newStage: targetStage,
        stageNumber: String(stageNumber),
        progressPct: String(progressPct),
        status: updated.status,
        note: note || '',
      },
    });

    return updated;
  }

  async adminReview(
    userId: string,
    projectId: string,
    action: 'APPROVE' | 'REQUEST_INFO' | 'REJECT',
    notes?: string,
  ): Promise<ProjectRecord> {
    const existing = await this.projects.findById(projectId);
    if (!existing) throw this.notFound();

    let newStatus: ProjectStatus;
    if (action === 'APPROVE') {
      newStatus = ProjectStatus.READY_FOR_ASSIGNMENT;
    } else if (action === 'REQUEST_INFO') {
      newStatus = ProjectStatus.NEEDS_INFO;
    } else {
      newStatus = ProjectStatus.REJECTED;
    }

    const updated = await this.projects.update(projectId, existing.organizationId, {
      status: newStatus,
      adminReviewNotes: notes || '',
    });
    if (!updated) throw this.notFound();

    await this.audit.append({
      actorUserId: userId,
      organizationId: existing.organizationId,
      action: `PROJECT_REVIEW_${action}`,
      resourceType: 'PROJECT',
      resourceId: projectId,
      metadata: {
        action,
        status: newStatus,
        notes: notes || '',
      },
    });

    return updated;
  }

  async acceptProject(
    userId: string,
    organizationHeader: string | undefined,
    projectId: string,
    notes?: string,
  ): Promise<ProjectRecord> {
    const organization = await this.organizationContext.resolve(userId, organizationHeader, projectId);
    const existing = await this.requireProject(projectId, organization.id);

    const allUsers = await this.rbac.getAllUsers();
    const user = allUsers.find((u) => u.id === userId);

    const updated = await this.projects.recordAcceptance(projectId, {
      accepted: true,
      acceptedBy: userId,
      acceptedByName: user?.fullName || user?.email || 'Customer Representative',
      acceptedAt: new Date(),
      notes: notes || 'Modernization deliverables approved and accepted by customer.',
    });
    if (!updated) throw this.notFound();

    await this.audit.append({
      actorUserId: userId,
      organizationId: organization.id,
      action: 'PROJECT_ACCEPTED_BY_CUSTOMER',
      resourceType: 'PROJECT',
      resourceId: projectId,
      metadata: {
        acceptedBy: userId,
        acceptedByName: user?.fullName || user?.email || '',
        notes: notes || '',
        status: updated.status,
        currentStage: updated.currentStage || '',
      },
    });

    return updated;
  }

  async list(
    userId: string,
    organizationHeader?: string,
    isPlatformAdmin = false,
  ): Promise<ProjectRecord[]> {
    if (isPlatformAdmin && !organizationHeader?.trim()) {
      return this.projects.findAll();
    }
    const organization = await this.organizationContext.resolve(userId, organizationHeader);
    const own = await this.projects.findAll(organization.id);
    const allocated = (await this.projects.findByAssignedStaff(userId)) ?? [];
    const known = new Set(own.map((p) => p.id));
    return [...own, ...allocated.filter((p) => !known.has(p.id))];
  }

  async get(
    userId: string,
    organizationHeader: string | undefined,
    id: string,
  ): Promise<ProjectRecord> {
    const organization = await this.organizationContext.resolve(userId, organizationHeader, id);
    return this.requireProject(id, organization.id);
  }

  async update(
    userId: string,
    organizationHeader: string | undefined,
    id: string,
    input: {
      name?: string;
      description?: string;
      status?: ProjectStatus;
      currentStage?: ManagedProjectStage;
      adminReviewNotes?: string;
    },
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
