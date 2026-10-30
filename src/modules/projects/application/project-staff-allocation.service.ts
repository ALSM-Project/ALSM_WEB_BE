import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AUDIT_REPOSITORY, AuditRepository } from '../../audit/domain/audit.repository';
import { RbacService } from '../../rbac/application/rbac.service';
import { MailService } from '../../../shared/mail/mail.service';
import { PROJECT_REPOSITORY, ProjectRecord, ProjectRepository } from '../domain/project.types';

export const PROJECT_STAFF_ALLOCATED = 'PROJECT_STAFF_ALLOCATED';
export const CONVERSION_STAFF_ROLE = 'CONVERSION_STAFF';
const NOTE_MAX_LENGTH = 1000;

export interface AssignableStaffMember {
  id: string;
  fullName: string;
  email: string;
  role: string;
  /** Projects the person is carrying right now (not yet exported). */
  activeWorkload: number;
}

/**
 * UC-86: a Team Lead allocates a project to one Conversion Staff member. The allocation is
 * stored on the project, so the project (with all its screens and programs) shows up in that
 * person's work queue at once and leaves the queue of whoever had it before.
 */
@Injectable()
export class ProjectStaffAllocationService {
  constructor(
    @Inject(PROJECT_REPOSITORY) private readonly projects: ProjectRepository,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
    private readonly rbac: RbacService,
    private readonly mail: MailService,
  ) {}

  /** Active Conversion Staff accounts with the number of projects each one carries. */
  async listAssignableStaff(): Promise<AssignableStaffMember[]> {
    const [users, projects] = await Promise.all([this.rbac.getAllUsers(), this.projects.findAll()]);
    const workload = new Map<string, number>();
    for (const project of projects) {
      if (project.isExported || !project.assignedStaffId) continue;
      workload.set(project.assignedStaffId, (workload.get(project.assignedStaffId) ?? 0) + 1);
    }
    return users
      .filter((u) => !u.isLocked && this.isConversionStaff(u.roles))
      .map((u) => ({
        id: u.id,
        fullName: u.fullName || u.email,
        email: u.email,
        role: CONVERSION_STAFF_ROLE,
        activeWorkload: workload.get(u.id) ?? 0,
      }))
      .sort((a, b) => a.activeWorkload - b.activeWorkload || a.fullName.localeCompare(b.fullName));
  }

  async assign(
    actorUserId: string,
    projectId: string,
    staffUserId: string,
    note?: string,
    reason?: string,
  ): Promise<ProjectRecord> {
    const project = await this.projects.findById(projectId);
    if (!project) {
      throw new NotFoundException({ code: 'PROJECT_NOT_FOUND', message: 'Project was not found' });
    }
    const cleanNote = note?.trim() ?? '';
    if (cleanNote.length > NOTE_MAX_LENGTH) {
      throw new BadRequestException({
        code: 'ASSIGNMENT_NOTE_TOO_LONG',
        message: `The briefing note can have at most ${NOTE_MAX_LENGTH} characters`,
      });
    }

    const staff = (await this.rbac.getAllUsers()).find((u) => u.id === staffUserId);
    if (!staff) {
      throw new BadRequestException({ code: 'STAFF_NOT_FOUND', message: 'The selected user does not exist' });
    }
    if (staff.isLocked) {
      throw new BadRequestException({
        code: 'STAFF_NOT_ACTIVE',
        message: 'A locked account cannot be assigned a project',
      });
    }
    if (!this.isConversionStaff(staff.roles)) {
      throw new BadRequestException({
        code: 'STAFF_ROLE_INVALID',
        message: 'Only Conversion Staff can be assigned a project',
      });
    }
    if (project.assignedStaffId && project.assignedStaffId === staff.id) {
      throw new BadRequestException({
        code: 'SAME_ASSIGNEE_REJECTED',
        message: 'The selected staff member is already assigned to this project',
      });
    }
    const cleanReason = reason?.trim() ?? '';

    const previousStaffId = project.assignedStaffId;
    const updated = await this.projects.assignStaff(projectId, {
      staffId: staff.id,
      staffName: staff.fullName || staff.email,
      note: cleanNote,
      assignedBy: actorUserId,
    });
    if (!updated) {
      throw new NotFoundException({ code: 'PROJECT_NOT_FOUND', message: 'Project was not found' });
    }

    await this.audit.append({
      actorUserId,
      organizationId: updated.organizationId,
      action: PROJECT_STAFF_ALLOCATED,
      resourceType: 'PROJECT',
      resourceId: projectId,
      metadata: {
        staffId: staff.id,
        note: cleanNote,
        ...(cleanReason ? { reason: cleanReason } : {}),
        ...(previousStaffId ? { previousStaffId } : {}),
      },
    });
    const actor = (await this.rbac.getAllUsers()).find((u) => u.id === actorUserId);
    const actorName = actor?.fullName || actor?.email || 'Team Lead';
    try {
      await this.mail.sendProjectOwnershipTransferNotification({
        to: staff.email,
        assigneeName: staff.fullName || staff.email,
        projectName: updated.name,
        projectId: updated.id,
        transferredByName: actorName,
        reason: cleanReason || undefined,
        notes: cleanNote || undefined,
      });
    } catch {
      // Notification failure must not corrupt the completed transfer
    }
    return updated;
  }

  private isConversionStaff(roles: string[]): boolean {
    return roles.some((role) => role.toUpperCase() === CONVERSION_STAFF_ROLE);
  }
}
