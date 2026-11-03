import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  RESOURCE_TRANSFER_REQUEST_REPOSITORY,
  ResourceTransferRequestRecord,
  ResourceTransferRequestRepository,
  TransferRequestStatus,
} from '../domain/resource-transfer-request.types';
import {
  PROJECT_REPOSITORY,
  ProjectRecord,
  ProjectRepository,
} from '../domain/project.types';
import { ProjectStaffAllocationService } from './project-staff-allocation.service';
import { RbacService } from '../../rbac/application/rbac.service';
import {
  AUDIT_REPOSITORY,
  AuditRepository,
} from '../../audit/domain/audit.repository';
import {
  ApproveTransferRequestDto,
  CreateTransferRequestDto,
  RejectTransferRequestDto,
} from '../presentation/resource-transfer-request.dto';

export const RESOURCE_TRANSFER_APPROVED = 'RESOURCE_TRANSFER_APPROVED';
export const RESOURCE_TRANSFER_REJECTED = 'RESOURCE_TRANSFER_REJECTED';

@Injectable()
export class ResourceTransferApprovalService {
  constructor(
    @Inject(RESOURCE_TRANSFER_REQUEST_REPOSITORY)
    private readonly requestRepo: ResourceTransferRequestRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectsRepo: ProjectRepository,
    private readonly staffAllocationService: ProjectStaffAllocationService,
    private readonly rbac: RbacService,
    @Inject(AUDIT_REPOSITORY)
    private readonly audit: AuditRepository,
  ) {}

  /**
   * Create a new transfer request for a modernization project.
   */
  async createRequest(
    actorUserId: string,
    dto: CreateTransferRequestDto,
  ): Promise<ResourceTransferRequestRecord> {
    const project = await this.findProject(dto.projectId);
    if (!project) {
      throw new NotFoundException({
        code: 'PROJECT_NOT_FOUND',
        message: 'Project was not found',
      });
    }

    // Check if an existing PENDING request already exists for this project
    const pendingRequests = await this.requestRepo.findAll({
      projectId: project.id,
      status: 'PENDING',
    });
    if (pendingRequests.length > 0) {
      throw new BadRequestException({
        code: 'PENDING_REQUEST_EXISTS',
        message:
          'A pending resource transfer request already exists for this project',
      });
    }

    const allUsers = await this.rbac.getAllUsers();
    const targetStaff = allUsers.find((u) => u.id === dto.targetStaffId);
    if (!targetStaff) {
      throw new BadRequestException({
        code: 'STAFF_NOT_FOUND',
        message: 'The selected target staff member does not exist',
      });
    }
    if (targetStaff.isLocked) {
      throw new BadRequestException({
        code: 'STAFF_NOT_ACTIVE',
        message: 'A locked staff member cannot be assigned a project',
      });
    }
    if (!this.isConversionStaff(targetStaff.roles)) {
      throw new BadRequestException({
        code: 'STAFF_ROLE_INVALID',
        message: 'Only Conversion Staff can be assigned a project',
      });
    }

    if (
      project.assignedStaffId &&
      project.assignedStaffId === targetStaff.id
    ) {
      throw new BadRequestException({
        code: 'SAME_ASSIGNEE_REJECTED',
        message:
          'The selected staff member is already the current assignee for this project',
      });
    }

    const actor = allUsers.find((u) => u.id === actorUserId);
    const actorName = actor?.fullName || actor?.email || 'Authorized User';

    const cleanReason = dto.reason?.trim() || 'Workload Balancing';
    const cleanNote = dto.note?.trim() || '';

    return this.requestRepo.create({
      organizationId: project.organizationId,
      projectId: project.id,
      projectName: project.name,
      currentAssigneeId: project.assignedStaffId,
      currentAssigneeName: project.assignedStaffName || 'Unallocated',
      targetAssigneeId: targetStaff.id,
      targetAssigneeName: targetStaff.fullName || targetStaff.email,
      targetAssigneeEmail: targetStaff.email,
      requestedById: actorUserId,
      requestedByName: actorName,
      reason: cleanReason,
      note: cleanNote,
      status: 'PENDING',
    });
  }

  /**
   * List transfer requests authorized for the current Team Lead / Platform Admin.
   */
  async listRequests(
    actorUserId: string,
    isPlatformAdmin: boolean,
    filter?: { status?: TransferRequestStatus; search?: string },
  ): Promise<ResourceTransferRequestRecord[]> {
    const allRequests = await this.requestRepo.findAll(
      filter?.status ? { status: filter.status } : undefined,
    );

    let accessible = allRequests;
    if (!isPlatformAdmin) {
      const allProjects = await this.projectsRepo.findAll();
      const userProjects = (Array.isArray(allProjects) ? allProjects : []).filter(
        (p) =>
          p.assignedTeamLeadId === actorUserId ||
          p.createdBy === actorUserId,
      );
      const userProjectIds = new Set(userProjects.map((p) => p.id));

      // Also allow if the actor is requester or in the same organization
      accessible = allRequests.filter(
        (r) =>
          userProjectIds.has(r.projectId) ||
          r.requestedById === actorUserId ||
          userProjects.some((p) => p.organizationId === r.organizationId),
      );
    }

    if (filter?.search?.trim()) {
      const s = filter.search.toLowerCase().trim();
      accessible = accessible.filter(
        (r) =>
          r.projectName.toLowerCase().includes(s) ||
          r.targetAssigneeName.toLowerCase().includes(s) ||
          (r.currentAssigneeName &&
            r.currentAssigneeName.toLowerCase().includes(s)) ||
          r.requestedByName.toLowerCase().includes(s) ||
          r.reason.toLowerCase().includes(s),
      );
    }

    return accessible;
  }

  /**
   * Retrieve request details along with live authoritative validation.
   */
  async getRequestById(
    actorUserId: string,
    requestId: string,
    isPlatformAdmin = false,
  ): Promise<{
    request: ResourceTransferRequestRecord;
    isValid: boolean;
    validationErrors: string[];
    liveProject: ProjectRecord | null;
  }> {
    const request = await this.requestRepo.findById(requestId);
    if (!request) {
      throw new NotFoundException({
        code: 'TRANSFER_REQUEST_NOT_FOUND',
        message: 'Transfer request was not found',
      });
    }

    if (!isPlatformAdmin) {
      const allProjects = await this.projectsRepo.findAll();
      const userProjects = (Array.isArray(allProjects) ? allProjects : []).filter(
        (p) =>
          p.assignedTeamLeadId === actorUserId ||
          p.createdBy === actorUserId,
      );
      const userProjectIds = new Set(userProjects.map((p) => p.id));
      const hasAccess =
        userProjectIds.has(request.projectId) ||
        request.requestedById === actorUserId ||
        userProjects.some((p) => p.organizationId === request.organizationId);

      if (!hasAccess) {
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message: 'You are not authorized to view this transfer request',
        });
      }
    }

    const liveProject = await this.findProject(request.projectId);
    const validationErrors: string[] = [];

    if (!liveProject) {
      validationErrors.push('The associated project no longer exists');
    }

    const allUsers = await this.rbac.getAllUsers();
    const targetStaff = allUsers.find((u) => u.id === request.targetAssigneeId);
    if (!targetStaff) {
      validationErrors.push('The proposed target staff member no longer exists');
    } else {
      if (targetStaff.isLocked) {
        validationErrors.push('The proposed target staff member is locked');
      }
      if (!this.isConversionStaff(targetStaff.roles)) {
        validationErrors.push('The proposed target staff member no longer has the Conversion Staff role');
      }
    }

    if (
      liveProject &&
      liveProject.assignedStaffId &&
      liveProject.assignedStaffId === request.targetAssigneeId
    ) {
      validationErrors.push(
        'The proposed assignee is already assigned as the current owner',
      );
    }

    if (request.status !== 'PENDING') {
      validationErrors.push(
        `Request is already in ${request.status} status and cannot be modified`,
      );
    }

    return {
      request,
      isValid: validationErrors.length === 0,
      validationErrors,
      liveProject,
    };
  }

  /**
   * Approve a transfer request (UC-88) and integrate with UC-84 ownership transfer.
   */
  async approveRequest(
    actorUserId: string,
    requestId: string,
    dto?: ApproveTransferRequestDto,
  ): Promise<{
    success: boolean;
    request: ResourceTransferRequestRecord;
    project: ProjectRecord;
  }> {
    const request = await this.requestRepo.findById(requestId);
    if (!request) {
      throw new NotFoundException({
        code: 'TRANSFER_REQUEST_NOT_FOUND',
        message: 'Transfer request was not found',
      });
    }

    if (request.status !== 'PENDING') {
      throw new BadRequestException({
        code: 'REQUEST_ALREADY_PROCESSED',
        message: `Transfer request is already ${request.status}`,
      });
    }

    const allUsers = await this.rbac.getAllUsers();
    const approver = allUsers.find((u) => u.id === actorUserId);
    const approverName =
      approver?.fullName || approver?.email || 'Authorized Team Lead';

    // Verify approver has Team Lead capability
    const isTeamLeadOrAdmin =
      approver?.roles.some((r) => {
        const lower = r.toLowerCase();
        return (
          lower.includes('lead') ||
          lower.includes('admin') ||
          lower.includes('manager')
        );
      }) || approver?.isPlatformAdmin;

    if (!isTeamLeadOrAdmin) {
      throw new ForbiddenException({
        code: 'TEAM_LEAD_ROLE_REQUIRED',
        message: 'Only authorized Team Leads can approve resource transfer requests',
      });
    }

    // Authoritative check on target assignee
    const targetStaff = allUsers.find((u) => u.id === request.targetAssigneeId);
    if (!targetStaff) {
      throw new BadRequestException({
        code: 'STAFF_NOT_FOUND',
        message: 'The proposed target staff member no longer exists',
      });
    }
    if (targetStaff.isLocked) {
      throw new BadRequestException({
        code: 'STAFF_NOT_ACTIVE',
        message: 'The proposed target staff member is locked',
      });
    }
    if (!this.isConversionStaff(targetStaff.roles)) {
      throw new BadRequestException({
        code: 'STAFF_ROLE_INVALID',
        message: 'Only Conversion Staff can be assigned a project',
      });
    }

    // ─── INTEGRATE WITH UC-84 (ProjectStaffAllocationService) ───
    // This executes assignment, checks capacity, writes PROJECT_STAFF_ALLOCATED audit log,
    // and dispatches project transfer notification email to the new assignee.
    const updatedProject = await this.staffAllocationService.assign(
      actorUserId,
      request.projectId,
      request.targetAssigneeId,
      request.note,
      request.reason,
    );

    // Update Request status to APPROVED
    const reviewNote = dto?.note?.trim() || '';
    const updatedRequest = await this.requestRepo.update(requestId, {
      status: 'APPROVED',
      reviewedById: actorUserId,
      reviewedByName: approverName,
      reviewedAt: new Date(),
      reviewNote,
    });

    if (!updatedRequest) {
      throw new NotFoundException({
        code: 'TRANSFER_REQUEST_NOT_FOUND',
        message: 'Transfer request was not found during status update',
      });
    }

    // Record Approval Audit Log
    await this.audit.append({
      actorUserId,
      organizationId: request.organizationId,
      action: RESOURCE_TRANSFER_APPROVED,
      resourceType: 'PROJECT',
      resourceId: request.projectId,
      metadata: {
        requestId: request.id,
        ...(request.currentAssigneeId ? { previousAssigneeId: request.currentAssigneeId } : {}),
        newAssigneeId: request.targetAssigneeId,
        approvedBy: actorUserId,
        approvedByName: approverName,
        reason: request.reason,
        reviewNote,
      },
    });

    return {
      success: true,
      request: updatedRequest,
      project: updatedProject,
    };
  }

  /**
   * Reject a transfer request.
   */
  async rejectRequest(
    actorUserId: string,
    requestId: string,
    dto: RejectTransferRequestDto,
  ): Promise<{ success: boolean; request: ResourceTransferRequestRecord }> {
    const request = await this.requestRepo.findById(requestId);
    if (!request) {
      throw new NotFoundException({
        code: 'TRANSFER_REQUEST_NOT_FOUND',
        message: 'Transfer request was not found',
      });
    }

    if (request.status !== 'PENDING') {
      throw new BadRequestException({
        code: 'REQUEST_ALREADY_PROCESSED',
        message: `Transfer request is already ${request.status}`,
      });
    }

    const allUsers = await this.rbac.getAllUsers();
    const approver = allUsers.find((u) => u.id === actorUserId);
    const approverName =
      approver?.fullName || approver?.email || 'Authorized Team Lead';

    const isTeamLeadOrAdmin =
      approver?.roles.some((r) => {
        const lower = r.toLowerCase();
        return (
          lower.includes('lead') ||
          lower.includes('admin') ||
          lower.includes('manager')
        );
      }) || approver?.isPlatformAdmin;

    if (!isTeamLeadOrAdmin) {
      throw new ForbiddenException({
        code: 'TEAM_LEAD_ROLE_REQUIRED',
        message: 'Only authorized Team Leads can review resource transfer requests',
      });
    }

    const rejectionReason = dto.reason.trim();
    const updatedRequest = await this.requestRepo.update(requestId, {
      status: 'REJECTED',
      reviewedById: actorUserId,
      reviewedByName: approverName,
      reviewedAt: new Date(),
      rejectionReason,
    });

    if (!updatedRequest) {
      throw new NotFoundException({
        code: 'TRANSFER_REQUEST_NOT_FOUND',
        message: 'Transfer request was not found',
      });
    }

    await this.audit.append({
      actorUserId,
      organizationId: request.organizationId,
      action: RESOURCE_TRANSFER_REJECTED,
      resourceType: 'PROJECT',
      resourceId: request.projectId,
      metadata: {
        requestId: request.id,
        rejectedBy: actorUserId,
        rejectionReason,
      },
    });

    return {
      success: true,
      request: updatedRequest,
    };
  }

  private async findProject(projectId: string): Promise<ProjectRecord | null> {
    let project = await this.projectsRepo.findById(projectId, '');
    if (!project) {
      const all = await this.projectsRepo.findAll();
      project =
        Array.isArray(all) ? all.find((p) => p.id === projectId) ?? null : null;
    }
    return project;
  }

  private isConversionStaff(roles: string[]): boolean {
    return roles.some((role) => {
      const r = role.toLowerCase().replace(/[_\s-]/g, '');
      return (
        r === 'conversionstaff' ||
        r === 'staff' ||
        r.includes('conversion') ||
        r.includes('engineer')
      );
    });
  }
}
