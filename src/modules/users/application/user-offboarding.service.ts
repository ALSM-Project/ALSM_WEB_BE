import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from '../infrastructure/user.schema';
import { Project, ProjectDocument } from '../../projects/infrastructure/project.schema';
import { ConversionJob, ConversionJobDocument } from '../../conversions/infrastructure/conversion-job.schema';
import { UserSession, UserSessionDocument } from '../../auth/infrastructure/user-session.schema';
import { RbacService } from '../../rbac/application/rbac.service';
import { AUDIT_REPOSITORY, AuditRepository } from '../../audit/domain/audit.repository';
import {
  ExecuteUserOffboardingDto,
  ProjectTransferItemDto,
} from '../presentation/user-offboarding.dto';
import {
  DepartingStaffDossier,
  OffboardingActiveSession,
  OffboardingAssignedProject,
  OffboardingEligibleSuccessor,
  OffboardingPendingJob,
  UserOffboardingResult,
  UserOffboardingSummary,
} from '../domain/user-offboarding.types';

function toObjectId(id: string): Types.ObjectId {
  if (!id || !Types.ObjectId.isValid(id)) {
    throw new BadRequestException({
      code: 'INVALID_OBJECT_ID',
      message: `Invalid ID format: '${id}'`,
    });
  }
  return new Types.ObjectId(id);
}

@Injectable()
export class UserOffboardingService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Project.name) private readonly projectModel: Model<ProjectDocument>,
    @InjectModel(ConversionJob.name) private readonly jobModel: Model<ConversionJobDocument>,
    @InjectModel(UserSession.name) private readonly sessionModel: Model<UserSessionDocument>,
    private readonly rbacService: RbacService,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
  ) {}

  /**
   * Retrieve authoritative user details, security posture, and assigned resources (UC-83 4.2 & 4.3).
   */
  async getOffboardingSummary(
    actorUserId: string,
    targetUserId: string,
    isPlatformAdmin = false,
  ): Promise<UserOffboardingSummary> {
    const targetOid = toObjectId(targetUserId);
    const user = await this.userModel.findById(targetOid).exec();
    if (!user) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'Target staff member was not found',
      });
    }

    // Role and scope authorization validation
    if (!isPlatformAdmin && user.isPlatformAdmin) {
      throw new ForbiddenException({
        code: 'CANNOT_OFFBOARD_PLATFORM_ADMIN',
        message: 'Team Leads cannot offboard Platform Administrators',
      });
    }

    const [userRoles, activeSessions, assignedProjects, pendingJobs, allUsers, allProjects] =
      await Promise.all([
        this.rbacService.getUserRoles(user.id),
        this.sessionModel
          .find({
            userId: user._id,
            revokedAt: { $exists: false },
            expiresAt: { $gt: new Date() },
          })
          .sort({ lastActiveAt: -1 })
          .exec(),
        this.projectModel
          .find({
            $or: [
              { assignedStaffId: user._id },
              { assignedTeamLeadId: user._id },
              { createdBy: user._id },
            ],
            deletedAt: { $exists: false },
          })
          .sort({ updatedAt: -1 })
          .exec(),
        this.jobModel
          .find({
            createdBy: user._id,
            status: { $in: ['QUEUED', 'PROCESSING'] },
          })
          .exec(),
        this.userModel
          .find({
            _id: { $ne: user._id },
            isActive: true,
            isLocked: false,
          })
          .select('fullName email isPlatformAdmin')
          .exec(),
        this.projectModel
          .find({
            isExported: { $ne: true },
            deletedAt: { $exists: false },
            assignedStaffId: { $exists: true, $ne: null },
          })
          .select('assignedStaffId')
          .exec(),
      ]);

    // Calculate active project workload for candidate successors
    const workloadMap = new Map<string, number>();
    for (const p of allProjects) {
      if (p.assignedStaffId) {
        const sid = p.assignedStaffId.toString();
        workloadMap.set(sid, (workloadMap.get(sid) || 0) + 1);
      }
    }

    // Retrieve roles for candidate successors
    const allUserRoles = await this.rbacService.getAllUsers();
    const candidateRolesMap = new Map<string, string[]>();
    for (const u of allUserRoles) {
      candidateRolesMap.set(u.id, u.roles);
    }

    const eligibleStaff: OffboardingEligibleSuccessor[] = allUsers.map((u) => ({
      id: u.id,
      fullName: u.fullName || u.email,
      email: u.email,
      roles: candidateRolesMap.get(u.id) || (u.isPlatformAdmin ? ['ADMIN'] : ['CONVERSION_STAFF']),
      activeWorkload: workloadMap.get(u.id) || 0,
    }));

    // Map assigned projects with role differentiation
    const mappedProjects: OffboardingAssignedProject[] = assignedProjects.map((p) => {
      let role: 'CONVERSION_STAFF' | 'TEAM_LEAD' | 'OWNER' = 'OWNER';
      if (p.assignedStaffId?.toString() === user.id) {
        role = 'CONVERSION_STAFF';
      } else if (p.assignedTeamLeadId?.toString() === user.id) {
        role = 'TEAM_LEAD';
      }
      return {
        id: p.id,
        name: p.name,
        status: p.status,
        organizationId: p.organizationId.toString(),
        assignedRole: role,
        isTransferable: true,
      };
    });

    const mappedSessions: OffboardingActiveSession[] = activeSessions.map((s) => ({
      id: s.id,
      deviceType: s.deviceType,
      browser: s.browser,
      ipAddress: s.ipAddress,
      lastActiveAt: s.lastActiveAt,
      createdAt: s.createdAt,
    }));

    const mappedJobs: OffboardingPendingJob[] = pendingJobs.map((j) => ({
      id: j.id,
      projectId: j.projectId.toString(),
      status: j.status,
      priority: j.priority,
      conversionType: j.conversionType,
    }));

    const dossier: DepartingStaffDossier = {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      isActive: user.isActive,
      isLocked: user.isLocked,
      roles: userRoles.length > 0 ? userRoles : user.isPlatformAdmin ? ['ADMIN'] : ['CONVERSION_STAFF'],
    };

    return {
      user: dossier,
      activeSessionsCount: mappedSessions.length,
      activeSessions: mappedSessions,
      apiCredentialsCount: user.mfa?.enabled ? 1 : 0,
      assignedProjects: mappedProjects,
      pendingJobsCount: mappedJobs.length,
      pendingJobs: mappedJobs,
      eligibleStaff,
    };
  }

  /**
   * Execute controlled user offboarding workflow (UC-83 4.4 - 4.13).
   */
  async executeOffboarding(
    actorUserId: string,
    targetUserId: string,
    isPlatformAdmin = false,
    dto?: ExecuteUserOffboardingDto,
  ): Promise<UserOffboardingResult> {
    if (actorUserId === targetUserId) {
      throw new BadRequestException({
        code: 'CANNOT_OFFBOARD_SELF',
        message: 'You cannot offboard your own account',
      });
    }

    const targetOid = toObjectId(targetUserId);
    const targetUser = await this.userModel.findById(targetOid).exec();
    if (!targetUser) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'Target staff member was not found',
      });
    }

    if (!targetUser.isActive) {
      throw new BadRequestException({
        code: 'USER_ALREADY_OFFBOARDED',
        message: 'Target staff member is already offboarded or inactive',
      });
    }

    if (!isPlatformAdmin && targetUser.isPlatformAdmin) {
      throw new ForbiddenException({
        code: 'CANNOT_OFFBOARD_PLATFORM_ADMIN',
        message: 'Team Leads cannot offboard Platform Administrators',
      });
    }

    // 1. Identify all projects that require reassignment
    const assignedProjects = await this.projectModel
      .find({
        $or: [
          { assignedStaffId: targetUser._id },
          { assignedTeamLeadId: targetUser._id },
        ],
        deletedAt: { $exists: false },
      })
      .exec();

    const transferMap = new Map<string, string>(); // projectId -> targetStaffId
    if (assignedProjects.length > 0) {
      if (dto?.transferToUserId) {
        for (const p of assignedProjects) {
          transferMap.set(p.id, dto.transferToUserId);
        }
      } else if (dto?.projectTransfers && dto.projectTransfers.length > 0) {
        for (const pt of dto.projectTransfers) {
          transferMap.set(pt.projectId, pt.targetStaffId);
        }
      }

      // Check all projects have a designated recipient
      const unassigned = assignedProjects.filter((p) => !transferMap.has(p.id));
      if (unassigned.length > 0) {
        throw new BadRequestException({
          code: 'UNASSIGNED_TRANSFERABLE_RESOURCES',
          message: `Transferable resources must be reassigned before account deactivation (${unassigned.length} project(s) remain unassigned)`,
        });
      }
    }

    // Validate designated recipient staff members
    const recipientIds = Array.from(new Set(transferMap.values()));
    const recipientsMap = new Map<string, UserDocument>();
    for (const rId of recipientIds) {
      if (rId === targetUserId) {
        throw new BadRequestException({
          code: 'INVALID_TRANSFER_TARGET',
          message: 'Successor cannot be the departing staff member',
        });
      }
      const recipient = await this.userModel.findById(toObjectId(rId)).exec();
      if (!recipient || !recipient.isActive || recipient.isLocked) {
        throw new BadRequestException({
          code: 'INELIGIBLE_SUCCESSOR',
          message: `Designated successor staff member '${rId}' is invalid, inactive, or locked`,
        });
      }
      recipientsMap.set(rId, recipient);
    }

    // 2. Transfer project ownerships (UC-84 integration)
    const transferredProjects: Array<{
      projectId: string;
      projectName: string;
      previousOwnerId?: string;
      newOwnerId: string;
      newOwnerName: string;
    }> = [];

    const now = new Date();
    const actorOid = Types.ObjectId.isValid(actorUserId) ? new Types.ObjectId(actorUserId) : undefined;

    for (const project of assignedProjects) {
      const recipientId = transferMap.get(project.id)!;
      const recipient = recipientsMap.get(recipientId)!;
      const prevStaffId = project.assignedStaffId?.toString();

      let modified = false;
      if (project.assignedStaffId?.toString() === targetUserId) {
        project.assignedStaffId = recipient._id;
        project.assignedStaffName = recipient.fullName || recipient.email;
        project.staffAssignedBy = actorOid;
        project.staffAssignedAt = now;
        project.staffAssignmentNote = dto?.reason || 'Staff offboarding reassignment';
        modified = true;
      }

      if (project.assignedTeamLeadId?.toString() === targetUserId) {
        project.assignedTeamLeadId = recipient._id;
        modified = true;
      }

      if (modified) {
        await project.save();
        transferredProjects.push({
          projectId: project.id,
          projectName: project.name,
          previousOwnerId: prevStaffId,
          newOwnerId: recipient.id,
          newOwnerName: recipient.fullName || recipient.email,
        });

        // Audit each project reassignment according to UC-84 convention
        await this.audit.append({
          actorUserId,
          organizationId: project.organizationId.toString(),
          action: 'PROJECT_STAFF_ALLOCATED',
          resourceType: 'PROJECT',
          resourceId: project.id,
          metadata: {
            previousStaffId: prevStaffId || 'Unallocated',
            newStaffId: recipient.id,
            newStaffName: recipient.fullName || recipient.email,
            reason: dto?.reason || 'Staff offboarding reassignment',
          },
        });
      }
    }

    // 3. Reassign any pending conversion batch jobs created by departing staff
    await this.jobModel.updateMany(
      {
        createdBy: targetUser._id,
        status: { $in: ['QUEUED', 'PROCESSING'] },
      },
      {
        $set: {
          ...(recipientIds[0] ? { createdBy: recipientsMap.get(recipientIds[0])!._id } : {}),
        },
      },
    );

    // 4. Invalidate all active sessions (UC-83 4.8)
    const sessionRevocationResult = await this.sessionModel.updateMany(
      { userId: targetUser._id, revokedAt: { $exists: false } },
      { $set: { revokedAt: now } },
    );

    await this.audit.append({
      actorUserId,
      action: 'USER_ALL_SESSIONS_REVOKED',
      resourceType: 'USER_SESSION',
      resourceId: targetUserId,
      metadata: {
        revokedSessionsCount: sessionRevocationResult.modifiedCount.toString(),
      },
    });

    // 5. Invalidate API credentials & MFA (UC-83 4.9)
    if (targetUser.mfa?.enabled) {
      targetUser.mfa.enabled = false;
      targetUser.mfa.secret = null;
      targetUser.mfa.backupCodeHashes = [];
    }

    await this.audit.append({
      actorUserId,
      action: 'API_CREDENTIALS_REVOKED',
      resourceType: 'USER',
      resourceId: targetUserId,
      metadata: {
        targetUserEmail: targetUser.email,
      },
    });

    // 6. Remove internal roles (UC-83 4.10)
    const previousRoles = await this.rbacService.getUserRoles(targetUserId);
    await this.rbacService.updateUserRoles(targetUserId, [], actorUserId);

    await this.audit.append({
      actorUserId,
      action: 'USER_ROLES_REMOVED',
      resourceType: 'USER',
      resourceId: targetUserId,
      metadata: {
        previousRoles: previousRoles.join(','),
      },
    });

    // 7. Deactivate and lock the user account (UC-83 4.11)
    targetUser.isActive = false;
    targetUser.isLocked = true;
    targetUser.lockReason = dto?.reason || 'Staff member offboarded';
    targetUser.lockedAt = now;
    targetUser.lockedBy = actorUserId;
    targetUser.lockDuration = 'PERMANENT';
    await targetUser.save();

    // 8. Log overall offboarding audit event (UC-83 4.12)
    await this.audit.append({
      actorUserId,
      action: 'USER_OFFBOARDED',
      resourceType: 'USER',
      resourceId: targetUserId,
      metadata: {
        email: targetUser.email,
        fullName: targetUser.fullName,
        reason: dto?.reason || 'Offboarding completed',
        transferredProjectsCount: transferredProjects.length.toString(),
        transferredToUserIds: recipientIds.join(','),
        revokedSessionsCount: sessionRevocationResult.modifiedCount.toString(),
      },
    });

    return {
      success: true,
      message: `Staff member ${targetUser.fullName} (${targetUser.email}) has been successfully offboarded.`,
      user: {
        id: targetUser.id,
        email: targetUser.email,
        isActive: false,
        isLocked: true,
      },
      operations: {
        projectsTransferred: transferredProjects.length,
        sessionsRevoked: sessionRevocationResult.modifiedCount,
        apiCredentialsRevoked: targetUser.mfa?.enabled ? 1 : 0,
        rolesRemoved: previousRoles.length,
        accountDeactivated: true,
      },
      transferredProjects,
    };
  }
}
