import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AUDIT_REPOSITORY, AuditRepository } from '../../audit/domain/audit.repository';
import { RbacService } from '../../rbac/application/rbac.service';
import { MailService } from '../../../shared/mail/mail.service';
import { WorkforceService } from '../../workforce/application/workforce.service';
import { PROJECT_REPOSITORY, ProjectRecord, ProjectRepository } from '../domain/project.types';

export const PROJECT_STAFF_ALLOCATED = 'PROJECT_STAFF_ALLOCATED';
export const PROJECT_STAFF_REMOVED = 'PROJECT_STAFF_REMOVED';
export const CONVERSION_STAFF_ROLE = 'CONVERSION_STAFF';
const NOTE_MAX_LENGTH = 1000;
const MAX_CAPACITY = 5;

const SKILL_SETS = [
  ['COBOL', 'BMS/DSPF', 'Java 21', 'Spring Boot 3.3', 'PostgreSQL'],
  ['COBOL', 'MicroFocus', 'Java', 'JUnit', 'Oracle SQL'],
  ['BMS', 'DSPF', 'React 19', 'TypeScript', 'Tailwind CSS'],
  ['COBOL', 'CICS', 'Spring Boot', 'REST APIs', 'Docker'],
  ['AS400', 'DSPF', 'Next.js', 'TypeScript', 'Jest / Vitest'],
  ['COBOL', 'Mainframe JCL', 'Java', 'Spring Cloud', 'Kafka'],
];

export interface AssignableStaffMember {
  id: string;
  fullName: string;
  email: string;
  role: string;
  /** Projects the person is carrying right now (not yet exported). */
  activeWorkload: number;
}

export interface EligibleStaffMember extends AssignableStaffMember {
  maxCapacity: number;
  availableCapacity: number;
  availability: 'AVAILABLE' | 'MODERATE' | 'BUSY' | 'OVERLOADED';
  technicalSkills: string[];
  isAssignedToThisProject: boolean;
}

export interface ProjectAllocationDetails {
  project: ProjectRecord;
  assignedStaff: Array<{
    id: string;
    fullName: string;
    email: string;
    role: string;
    activeWorkload: number;
    maxCapacity: number;
    technicalSkills: string[];
    assignedAt?: Date;
    assignedBy?: string;
    assignedByName?: string;
    note?: string;
  }>;
  teamLead?: {
    id: string;
    fullName: string;
    email: string;
  } | null;
  metrics: {
    requiredStaffCount: number;
    assignedStaffCount: number;
    workloadStatus: 'OPTIMAL' | 'MODERATE' | 'OVERLOADED';
    allocationHealth: 'HEALTHY' | 'ACTION_REQUIRED';
  };
}

export interface AllocationHistoryItem {
  id: string;
  action: string;
  timestamp: Date;
  actorId?: string;
  actorName: string;
  actorEmail?: string;
  staffId?: string;
  staffName?: string;
  note?: string;
  reason?: string;
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
    private readonly workforce: WorkforceService,
  ) {}

  private getSkillsForUser(userId: string, index: number): string[] {
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
    }
    const setIdx = (hash + index) % SKILL_SETS.length;
    return SKILL_SETS[setIdx];
  }

  /** Active Conversion Staff accounts with the number of projects each one carries. */
  async listAssignableStaff(): Promise<AssignableStaffMember[]> {
    let internalStaff: any[];
    let projects: any[];
    if (this.workforce?.getInternalEmployees) {
      [internalStaff, projects] = await Promise.all([
        this.workforce.getInternalEmployees(),
        this.projects.findAll(),
      ]);
    } else {
      const [allUsers, allProjects] = await Promise.all([
        this.rbac.getAllUsers(),
        this.projects.findAll(),
      ]);
      projects = allProjects;
      internalStaff = allUsers
        .filter((u) => !u.isLocked && this.isConversionStaff(u.roles))
        .map((u) => ({
          userId: u.id,
          fullName: u.fullName || u.email,
          email: u.email,
          role: CONVERSION_STAFF_ROLE,
          status: 'ACTIVE',
        }));
    }

    const workload = new Map<string, number>();
    for (const project of projects) {
      if (project.isExported || !project.assignedStaffId) continue;
      workload.set(project.assignedStaffId, (workload.get(project.assignedStaffId) ?? 0) + 1);
    }

    return internalStaff
      .filter((emp) => emp.status === 'ACTIVE')
      .map((emp) => {
        const activeWorkload = workload.get(emp.userId) ?? 0;
        return {
          id: emp.userId,
          fullName: emp.fullName || emp.email,
          email: emp.email,
          role: CONVERSION_STAFF_ROLE,
          activeWorkload,
        };
      })
      .sort((a, b) => a.activeWorkload - b.activeWorkload || a.fullName.localeCompare(b.fullName));
  }

  async getProjectAllocation(projectId: string): Promise<ProjectAllocationDetails> {
    let project = await this.projects.findById(projectId);
    if (!project) {
      const allProjects = await this.projects.findAll();
      project = Array.isArray(allProjects) ? (allProjects.find((p) => p.id === projectId) ?? null) : null;
    }
    if (!project) {
      throw new NotFoundException({ code: 'PROJECT_NOT_FOUND', message: 'Project was not found' });
    }

    const [allStaff, allUsers] = await Promise.all([
      this.listAssignableStaff(),
      this.rbac.getAllUsers(),
    ]);

    const assignedStaffList: ProjectAllocationDetails['assignedStaff'] = [];
    if (project.assignedStaffId) {
      const staffMember = allStaff.find((s) => s.id === project.assignedStaffId);
      const userDoc = allUsers.find((u) => u.id === project.assignedStaffId);
      const assignedByDoc = project.staffAssignedBy
        ? allUsers.find((u) => u.id === project.staffAssignedBy)
        : null;

      assignedStaffList.push({
        id: project.assignedStaffId,
        fullName: project.assignedStaffName || staffMember?.fullName || userDoc?.fullName || 'Conversion Specialist',
        email: staffMember?.email || userDoc?.email || '',
        role: CONVERSION_STAFF_ROLE,
        activeWorkload: staffMember?.activeWorkload ?? 1,
        maxCapacity: MAX_CAPACITY,
        technicalSkills: staffMember ? this.getSkillsForUser(staffMember.id, 0) : ['COBOL', 'Java', 'Spring Boot'],
        assignedAt: project.staffAssignedAt,
        assignedBy: project.staffAssignedBy,
        assignedByName: assignedByDoc?.fullName || assignedByDoc?.email,
        note: project.staffAssignmentNote,
      });
    }

    let teamLead: ProjectAllocationDetails['teamLead'] = null;
    if (project.assignedTeamLeadId) {
      const tl = allUsers.find((u) => u.id === project.assignedTeamLeadId);
      if (tl) {
        teamLead = {
          id: tl.id,
          fullName: tl.fullName || tl.email,
          email: tl.email,
        };
      }
    }

    const isAssigned = assignedStaffList.length > 0;
    const isOverloaded = isAssigned && assignedStaffList[0].activeWorkload >= MAX_CAPACITY;

    return {
      project,
      assignedStaff: assignedStaffList,
      teamLead,
      metrics: {
        requiredStaffCount: 1,
        assignedStaffCount: assignedStaffList.length,
        workloadStatus: isOverloaded ? 'OVERLOADED' : isAssigned ? 'OPTIMAL' : 'MODERATE',
        allocationHealth: isAssigned ? 'HEALTHY' : 'ACTION_REQUIRED',
      },
    };
  }

  async getEligibleStaff(projectId: string): Promise<EligibleStaffMember[]> {
    let project = await this.projects.findById(projectId);
    if (!project) {
      const allProjects = await this.projects.findAll();
      project = Array.isArray(allProjects) ? (allProjects.find((p) => p.id === projectId) ?? null) : null;
    }
    const staff = await this.listAssignableStaff();
    return staff.map((s, idx) => {
      const availableCapacity = Math.max(0, MAX_CAPACITY - s.activeWorkload);
      const availability: 'AVAILABLE' | 'MODERATE' | 'BUSY' | 'OVERLOADED' =
        s.activeWorkload <= 2 ? 'AVAILABLE' : s.activeWorkload <= 4 ? 'MODERATE' : s.activeWorkload === 5 ? 'BUSY' : 'OVERLOADED';

      return {
        ...s,
        maxCapacity: MAX_CAPACITY,
        availableCapacity,
        availability,
        technicalSkills: this.getSkillsForUser(s.id, idx),
        isAssignedToThisProject: !!project?.assignedStaffId && project.assignedStaffId === s.id,
      };
    });
  }

  async assign(
    actorUserId: string,
    projectId: string,
    staffUserId: string,
    note?: string,
    reason?: string,
  ): Promise<ProjectRecord> {
    let project = await this.projects.findById(projectId);
    if (!project) {
      const allProjects = await this.projects.findAll();
      project = Array.isArray(allProjects) ? (allProjects.find((p) => p.id === projectId) ?? null) : null;
    }
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

  async removeAllocation(
    actorUserId: string,
    projectId: string,
    staffId: string,
    reason?: string,
  ): Promise<ProjectRecord> {
    let project = await this.projects.findById(projectId);
    if (!project) {
      const allProjects = await this.projects.findAll();
      project = Array.isArray(allProjects) ? (allProjects.find((p) => p.id === projectId) ?? null) : null;
    }
    if (!project) {
      throw new NotFoundException({ code: 'PROJECT_NOT_FOUND', message: 'Project was not found' });
    }
    if (project.assignedStaffId && project.assignedStaffId !== staffId) {
      throw new BadRequestException({
        code: 'STAFF_NOT_ASSIGNED',
        message: 'The specified staff member is not currently assigned to this project',
      });
    }

    const previousStaffId = project.assignedStaffId;
    const previousStaffName = project.assignedStaffName;
    const updated = await this.projects.removeStaff(projectId);
    if (!updated) {
      throw new NotFoundException({ code: 'PROJECT_NOT_FOUND', message: 'Project was not found' });
    }

    const cleanReason = reason?.trim() ?? '';
    await this.audit.append({
      actorUserId,
      organizationId: updated.organizationId,
      action: PROJECT_STAFF_REMOVED,
      resourceType: 'PROJECT',
      resourceId: projectId,
      metadata: {
        staffId: previousStaffId || staffId,
        staffName: previousStaffName || '',
        ...(cleanReason ? { reason: cleanReason } : {}),
      },
    });

    return updated;
  }

  async getAllocationHistory(projectId: string): Promise<AllocationHistoryItem[]> {
    if (!this.audit.findByResource) {
      return [];
    }
    const [records, users] = await Promise.all([
      this.audit.findByResource('PROJECT', projectId),
      this.rbac.getAllUsers(),
    ]);

    const userMap = new Map<string, { fullName: string; email: string }>();
    for (const u of users) {
      userMap.set(u.id, { fullName: u.fullName || u.email, email: u.email });
    }

    return records
      .filter((r) =>
        r.action === PROJECT_STAFF_ALLOCATED ||
        r.action === PROJECT_STAFF_REMOVED ||
        r.action.includes('STAFF') ||
        r.action.includes('ALLOCAT')
      )
      .map((r) => {
        const actor = r.actorUserId ? userMap.get(r.actorUserId) : null;
        return {
          id: r.id,
          action: r.action,
          timestamp: r.createdAt || new Date(),
          actorId: r.actorUserId,
          actorName: actor?.fullName || 'System Lead',
          actorEmail: actor?.email,
          staffId: r.metadata?.staffId,
          staffName: r.metadata?.staffName,
          note: r.metadata?.note,
          reason: r.metadata?.reason,
        };
      });
  }

  private isConversionStaff(roles: string[]): boolean {
    return roles.some((role) => role.toUpperCase() === CONVERSION_STAFF_ROLE);
  }

  async getAssignedMembers(projectId: string): Promise<
    Array<{
      id: string;
      fullName: string;
      email: string;
      role: string;
    }>
  > {
    let project = await this.projects.findById(projectId);
    if (!project) {
      const all = await this.projects.findAll();
      project = Array.isArray(all) ? (all.find((p) => p.id === projectId) ?? null) : null;
    }
    if (!project) return [];

    const allUsers = await this.rbac.getAllUsers();
    const members: Array<{ id: string; fullName: string; email: string; role: string }> = [];

    if (project.assignedStaffId) {
      const staff = allUsers.find((u) => u.id === project.assignedStaffId);
      if (staff && staff.email) {
        members.push({
          id: staff.id,
          fullName: staff.fullName || project.assignedStaffName || staff.email,
          email: staff.email.toLowerCase(),
          role: 'CONVERSION_STAFF',
        });
      }
    }

    return members;
  }
}
