import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { TemporaryRole, TemporaryRoleDocument } from '../infrastructure/schemas/temporary-role.schema';
import { User, UserDocument } from '../../users/infrastructure/user.schema';
import { Role, RoleDocument } from '../infrastructure/schemas/role.schema';
import { UserRole, UserRoleDocument } from '../infrastructure/schemas/user-role.schema';
import { AUDIT_REPOSITORY, AuditRepository } from '../../audit/domain/audit.repository';
import { NotificationsService } from '../../notifications/notifications.service';
import { toValidObjectId } from '../../../shared/utils/object-id.util';
import { EligibleStaffQueryDto } from '../presentation/dtos/temporary-role.dto';
import { EffectivePermissionsService } from './effective-permissions.service';
import { IRbacRepository, RBAC_REPOSITORY } from '../domain/rbac.repository.interface';
import { Team } from '../../teams/infrastructure/team.schema';
import { Project } from '../../projects/infrastructure/project.schema';

export const MIN_TEMPORARY_ROLE_HOURS = 1;
export const MAX_TEMPORARY_ROLE_HOURS = 24;
export const MIN_JUSTIFICATION_LENGTH = 10;
const PLATFORM_ADMIN_ROLES = new Set(['SYSTEM_ADMIN', 'ADMIN', 'PLATFORM_ADMIN']);

function requireValidDuration(durationHours: number): void {
  if (
    !Number.isFinite(durationHours) ||
    durationHours < MIN_TEMPORARY_ROLE_HOURS ||
    durationHours > MAX_TEMPORARY_ROLE_HOURS
  ) {
    throw new BadRequestException(
      `Temporary role duration must be between ${MIN_TEMPORARY_ROLE_HOURS} and ${MAX_TEMPORARY_ROLE_HOURS} hours`,
    );
  }
}

function requireJustification(reason: string | undefined): string {
  const clean = reason?.trim() ?? '';
  if (clean.length < MIN_JUSTIFICATION_LENGTH) {
    throw new BadRequestException({
      code: 'JUSTIFICATION_TOO_SHORT',
      message: `The justification must have at least ${MIN_JUSTIFICATION_LENGTH} characters`,
    });
  }
  return clean;
}

@Injectable()
export class TemporaryRoleService {
  constructor(
    @InjectModel(TemporaryRole.name) private readonly tempRoleModel: Model<TemporaryRoleDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Role.name) private readonly roleModel: Model<RoleDocument>,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
    @Optional()
    @InjectModel(UserRole.name)
    private readonly userRoleModel?: Model<UserRoleDocument>,
    @Optional()
    private readonly notifications?: NotificationsService,
    @Optional()
    private readonly effectivePermissionsService?: EffectivePermissionsService,
    @Optional()
    @Inject(RBAC_REPOSITORY)
    private readonly rbacRepo?: IRbacRepository,
    @Optional()
    @InjectModel(Team.name)
    private readonly teamModel?: Model<any>,
    @Optional()
    @InjectModel(Project.name)
    private readonly projectModel?: Model<any>,
  ) {}

  async grantTemporaryRole(
    actorUserId: string,
    targetUserId: string,
    roleId: string,
    durationHours: number,
    reason: string,
    projectId?: string,
    existingDoc?: TemporaryRoleDocument,
  ) {
    requireValidDuration(durationHours);
    const justification = existingDoc
      ? reason?.trim() || existingDoc.reason || 'Approved temporary role request'
      : requireJustification(reason);

    const normalizedRole = roleId.toUpperCase().trim();
    if (PLATFORM_ADMIN_ROLES.has(normalizedRole)) {
      throw new ForbiddenException('Temporary role cannot grant Platform Admin privileges');
    }
    // Nobody raises their own privileges through this route.
    if (actorUserId === targetUserId) {
      throw new ForbiddenException('You cannot grant a temporary role to yourself');
    }

    const role = await this.roleModel.findOne({
      $or: [{ id: normalizedRole }, { name: normalizedRole }, { _id: toValidObjectId(roleId) }],
    }).exec();
    if (!role) {
      throw new NotFoundException(`Role '${roleId}' was not found`);
    }

    const targetUser = await this.userModel.findById(toValidObjectId(targetUserId)).exec();
    if (!targetUser) {
      throw new NotFoundException(`Target user '${targetUserId}' was not found`);
    }
    if ((targetUser as { isLocked?: boolean }).isLocked) {
      throw new BadRequestException('A locked account cannot receive a temporary role');
    }

    // A user can only have one active temporary role at a time
    const activeFilter: FilterQuery<TemporaryRoleDocument> = {
      userId: toValidObjectId(targetUserId),
      status: 'ACTIVE',
      expiresAt: { $gt: new Date() },
    };
    if (existingDoc?._id) {
      activeFilter._id = { $ne: existingDoc._id };
    }

    const activeExisting = await this.tempRoleModel.findOne(activeFilter).exec();
    if (activeExisting) {
      throw new ConflictException({
        code: 'ACTIVE_TEMPORARY_ROLE_EXISTS',
        message: 'The user already holds an active temporary role',
      });
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + durationHours * 3600 * 1000);

    if (existingDoc) {
      // Reusing and updating existing approved request document (UC-91 canonical execution)
      existingDoc.roleId = role.id || normalizedRole;
      existingDoc.grantedBy = toValidObjectId(actorUserId);
      existingDoc.grantedAt = now;
      existingDoc.expiresAt = expiresAt;
      existingDoc.durationHours = durationHours;
      existingDoc.status = 'ACTIVE';
      existingDoc.requestStatus = 'APPROVED';
      if (projectId) {
        existingDoc.projectId = toValidObjectId(projectId);
      }
      await existingDoc.save();

      await this.audit.append({
        actorUserId,
        action: 'TEMPORARY_ROLE_REQUEST_APPROVED',
        resourceType: 'TEMPORARY_ROLE',
        resourceId: existingDoc.id,
        metadata: {
          targetUserId,
          roleId: role.id || normalizedRole,
          durationHours: String(durationHours),
          grantedAt: now.toISOString(),
          expiresAt: expiresAt.toISOString(),
          ...(projectId ? { projectId } : {}),
          reason: justification,
        },
      });

      await this.notifyUser(
        targetUserId,
        'TEMPORARY_ROLE_APPROVED',
        'Temporary Role Request Approved',
        `Your request for temporary role "${role.id || normalizedRole}" has been approved for ${durationHours} hours.`,
        existingDoc.id,
      );

      return existingDoc;
    }

    const created = await this.tempRoleModel.create({
      userId: toValidObjectId(targetUserId),
      roleId: role.id || normalizedRole,
      grantedBy: toValidObjectId(actorUserId),
      grantedAt: now,
      expiresAt,
      durationHours,
      status: 'ACTIVE',
      reason: justification,
      requestStatus: 'APPROVED',
      ...(projectId ? { projectId: toValidObjectId(projectId) } : {}),
    });

    await this.audit.append({
      actorUserId,
      action: 'TEMPORARY_ROLE_GRANTED',
      resourceType: 'TEMPORARY_ROLE',
      resourceId: created.id,
      metadata: {
        targetUserId,
        roleId: role.id || normalizedRole,
        durationHours: String(durationHours),
        grantedAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        ...(projectId ? { projectId } : {}),
        reason: justification,
      },
    });

    await this.notifyUser(
      targetUserId,
      'TEMPORARY_ROLE_GRANTED',
      'Temporary Role Granted',
      `You have been granted temporary role "${role.id || normalizedRole}" for ${durationHours} hours.`,
      created.id,
    );

    return created;
  }

  async listTemporaryRoles(statusFilter?: string) {
    const filter: FilterQuery<TemporaryRoleDocument> = {};
    if (statusFilter && statusFilter !== 'ALL') {
      filter.status = statusFilter;
    }

    const docs = await this.tempRoleModel
      .find(filter)
      .populate('userId', 'fullName email')
      .populate('grantedBy', 'fullName email')
      .populate('requestedBy', 'fullName email')
      .sort({ createdAt: -1 })
      .exec();

    return docs;
  }

  async getMyRequests(userId: string) {
    const userObjId = toValidObjectId(userId);
    return this.tempRoleModel
      .find({ userId: userObjId })
      .populate('grantedBy', 'fullName email')
      .populate('requestedBy', 'fullName email')
      .sort({ createdAt: -1 })
      .exec();
  }

  async revokeTemporaryRole(actorUserId: string, id: string, reason?: string) {
    const revocationReason = reason?.trim() ?? '';
    if (!revocationReason) {
      throw new BadRequestException({
        code: 'REVOCATION_REASON_REQUIRED',
        message: 'A reason is required to revoke a temporary role',
      });
    }

    const objectId = toValidObjectId(id);
    const now = new Date();

    // Check if atomic findOneAndUpdate is available on the model (Mongoose runtime)
    const modelWithAtomic = this.tempRoleModel as unknown as {
      findOneAndUpdate?: (
        filter: unknown,
        update: unknown,
        options: unknown,
      ) => { exec: () => Promise<TemporaryRoleDocument | null> };
    };

    if (typeof modelWithAtomic.findOneAndUpdate === 'function') {
      const updated = await modelWithAtomic
        .findOneAndUpdate(
          {
            _id: objectId,
            status: 'ACTIVE',
            expiresAt: { $gt: now },
          },
          {
            $set: {
              status: 'REVOKED',
              revokedAt: now,
              revokedBy: toValidObjectId(actorUserId),
              revocationReason,
            },
          },
          { new: true },
        )
        .exec();

      if (updated) {
        await this.audit.append({
          actorUserId,
          action: 'TEMPORARY_ROLE_REVOKED',
          resourceType: 'TEMPORARY_ROLE',
          resourceId: updated.id,
          metadata: {
            targetUserId: updated.userId?.toString() ?? '',
            userId: updated.userId?.toString() ?? '',
            roleId: updated.roleId,
            previousStatus: 'ACTIVE',
            resultingStatus: 'REVOKED',
            revokedAt: now.toISOString(),
            reason: revocationReason,
          },
        });

        await this.notifyUser(
          updated.userId?.toString() ?? '',
          'TEMPORARY_ROLE_REVOKED',
          'Temporary Role Revoked',
          `Your temporary role "${updated.roleId}" has been revoked early. Reason: ${revocationReason}`,
          updated.id,
        );

        return updated;
      }
    }

    // Inspect document state to provide exact domain error or execute fallback revocation
    const doc = await this.tempRoleModel.findById(objectId).exec();
    if (!doc) {
      throw new NotFoundException('Temporary role was not found');
    }
    if (doc.status !== 'ACTIVE') {
      throw new ConflictException({
        code: 'TEMPORARY_ROLE_NOT_ACTIVE',
        message: `Only an active temporary role can be revoked; this one is ${doc.status}`,
      });
    }
    if (doc.expiresAt && doc.expiresAt <= now) {
      doc.status = 'EXPIRED';
      await doc.save();
      throw new ConflictException({
        code: 'TEMPORARY_ROLE_NOT_ACTIVE',
        message: 'Only an active temporary role can be revoked; this one has expired',
      });
    }

    doc.status = 'REVOKED';
    doc.revokedAt = now;
    doc.revokedBy = toValidObjectId(actorUserId);
    doc.revocationReason = revocationReason;
    await doc.save();

    await this.audit.append({
      actorUserId,
      action: 'TEMPORARY_ROLE_REVOKED',
      resourceType: 'TEMPORARY_ROLE',
      resourceId: doc.id,
      metadata: {
        targetUserId: doc.userId?.toString() ?? '',
        userId: doc.userId?.toString() ?? '',
        roleId: doc.roleId,
        previousStatus: 'ACTIVE',
        resultingStatus: 'REVOKED',
        revokedAt: now.toISOString(),
        reason: revocationReason,
      },
    });

    await this.notifyUser(
      doc.userId?.toString() ?? '',
      'TEMPORARY_ROLE_REVOKED',
      'Temporary Role Revoked',
      `Your temporary role "${doc.roleId}" has been revoked early. Reason: ${revocationReason}`,
      doc.id,
    );

    return doc;
  }

  async requestTemporaryRole(
    staffUserId: string,
    roleId: string,
    durationHours: number,
    reason: string,
    projectId?: string,
  ) {
    requireValidDuration(durationHours);
    const justification = requireJustification(reason);

    const normalizedRole = roleId.toUpperCase().trim();
    if (PLATFORM_ADMIN_ROLES.has(normalizedRole)) {
      throw new ForbiddenException('Cannot request Platform Admin role');
    }

    const requesterUser = await this.userModel.findById(toValidObjectId(staffUserId)).exec();
    if (requesterUser) {
      if ((requesterUser as { isLocked?: boolean }).isLocked) {
        throw new BadRequestException('A locked account cannot request a temporary role');
      }
      if ((requesterUser as { isActive?: boolean }).isActive === false) {
        throw new BadRequestException('A deactivated account cannot request a temporary role');
      }
      if (requesterUser.isPlatformAdmin) {
        throw new BadRequestException('Platform Admin already has full privileges');
      }
    }

    const role = await this.roleModel.findOne({
      $or: [{ id: normalizedRole }, { name: normalizedRole }, { _id: toValidObjectId(roleId) }],
    }).exec();
    if (role && PLATFORM_ADMIN_ROLES.has((role.id || '').toUpperCase())) {
      throw new ForbiddenException('Cannot request Platform Admin role');
    }

    // A user can only have one active temporary role at a time
    const activeExisting = await this.tempRoleModel.findOne({
      userId: toValidObjectId(staffUserId),
      status: 'ACTIVE',
      expiresAt: { $gt: new Date() },
    }).exec();

    if (activeExisting) {
      throw new ConflictException({
        code: 'ACTIVE_TEMPORARY_ROLE_EXISTS',
        message: 'You already hold an active temporary role',
      });
    }

    // A user cannot have multiple pending requests simultaneously
    const pendingExisting = await this.tempRoleModel.findOne({
      userId: toValidObjectId(staffUserId),
      requestStatus: 'PENDING',
    }).exec();

    if (pendingExisting) {
      throw new ConflictException({
        code: 'PENDING_TEMPORARY_ROLE_REQUEST_EXISTS',
        message: 'You already have a pending temporary role request awaiting review',
      });
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + durationHours * 3600 * 1000);

    const doc = await this.tempRoleModel.create({
      userId: toValidObjectId(staffUserId),
      roleId: role?.id || normalizedRole,
      grantedBy: toValidObjectId(staffUserId),
      grantedAt: now,
      expiresAt,
      durationHours,
      status: 'REVOKED', // not active until approved
      reason: justification,
      requestedBy: toValidObjectId(staffUserId),
      requestStatus: 'PENDING',
      ...(projectId ? { projectId: toValidObjectId(projectId) } : {}),
    });

    await this.audit.append({
      actorUserId: staffUserId,
      action: 'TEMPORARY_ROLE_REQUESTED',
      resourceType: 'TEMPORARY_ROLE',
      resourceId: doc.id,
      metadata: {
        roleId: role?.id || normalizedRole,
        durationHours: String(durationHours),
        reason: justification,
        ...(projectId ? { projectId } : {}),
      },
    });

    await this.notifyTeamLeads(
      'TEMPORARY_ROLE_REQUESTED',
      'New Temporary Role Request',
      `Staff user has submitted a request for temporary role "${role?.id || normalizedRole}" (${durationHours}h).`,
      doc.id,
    );

    return doc;
  }

  async reviewRequest(
    reviewerUserId: string,
    requestId: string,
    approved: boolean,
    reason?: string,
    durationHours?: number,
  ) {
    const doc = await this.tempRoleModel.findById(toValidObjectId(requestId)).exec();
    if (!doc) {
      throw new NotFoundException('Temporary role request was not found');
    }
    if (doc.requestStatus !== 'PENDING') {
      throw new ConflictException({
        code: 'REQUEST_ALREADY_REVIEWED',
        message: 'This request has already been reviewed',
      });
    }
    // Nobody approves their own request.
    if (doc.userId.toString() === reviewerUserId) {
      throw new ForbiddenException('You cannot review your own temporary role request');
    }
    if (!approved) {
      const cleanReason = reason?.trim();
      if (!cleanReason) {
        throw new BadRequestException({
          code: 'REJECTION_REASON_REQUIRED',
          message: 'A reason is required to reject a request',
        });
      }

      doc.requestStatus = 'REJECTED';
      doc.status = 'REVOKED';
      doc.revocationReason = cleanReason;
      await doc.save();

      await this.audit.append({
        actorUserId: reviewerUserId,
        action: 'TEMPORARY_ROLE_REQUEST_REJECTED',
        resourceType: 'TEMPORARY_ROLE',
        resourceId: doc.id,
        metadata: {
          requestId: doc.id,
          targetUserId: doc.userId.toString(),
          roleId: doc.roleId,
          reason: cleanReason,
        },
      });

      await this.notifyUser(
        doc.userId.toString(),
        'TEMPORARY_ROLE_REJECTED',
        'Temporary Role Request Rejected',
        `Your request for temporary role "${doc.roleId}" was rejected. Reason: ${cleanReason}`,
        doc.id,
      );

      return doc;
    }

    // Approved: Reuse existing canonical UC-91 implementation to grant the role
    const finalDuration = durationHours ?? doc.durationHours;
    return this.grantTemporaryRole(
      reviewerUserId,
      doc.userId.toString(),
      doc.roleId,
      finalDuration,
      doc.reason,
      doc.projectId?.toString(),
      doc,
    );
  }

  async getHistory() {
    const q1 = this.tempRoleModel
      .find()
      .populate('userId', 'fullName email')
      .populate('grantedBy', 'fullName email');
    const qFinal =
      typeof (q1 as { populate?: unknown }).populate === 'function'
        ? (q1 as { populate: (field: string, select: string) => typeof q1 }).populate(
            'requestedBy',
            'fullName email',
          )
        : q1;
    return qFinal.sort({ createdAt: -1 }).exec();
  }

  async exportHistoryCsv() {
    const history = await this.getHistory();
    const headers = 'ID,User,Role,DurationHours,GrantedAt,ExpiresAt,Status,Reason\n';
    const rows = history.map((h) => {
      const user = h.userId as unknown as { fullName?: string; email?: string } | undefined;
      const userStr = user?.fullName || user?.email || String(h.userId);
      return `"${h.id}","${userStr}","${h.roleId}","${h.durationHours}","${h.grantedAt ? h.grantedAt.toISOString() : ''}","${h.expiresAt ? h.expiresAt.toISOString() : ''}","${h.status}","${(h.reason || '').replace(/"/g, '""')}"`;
    });
    return headers + rows.join('\n');
  }

  async expireTemporaryRolesCron() {
    const now = new Date();
    const result = await this.tempRoleModel.updateMany(
      { status: 'ACTIVE', expiresAt: { $lte: now } },
      { $set: { status: 'EXPIRED' } },
    );
    return { expiredCount: result.modifiedCount };
  }

  private async notifyUser(
    targetUserId: string,
    type: string,
    title: string,
    message: string,
    resourceId?: string,
  ) {
    if (!this.notifications) return;
    try {
      await this.notifications.createForUsers({
        recipientUserIds: [targetUserId],
        type,
        title,
        message,
        eventKey: `${type}:${resourceId || Date.now()}`,
        resourceType: 'TEMPORARY_ROLE',
        resourceId,
        link: '/rbac/temporary-roles',
      });
    } catch {
      // Non-blocking notification delivery
    }
  }

  private async notifyTeamLeads(
    type: string,
    title: string,
    message: string,
    resourceId?: string,
  ) {
    if (!this.notifications || !this.userRoleModel) return;
    try {
      const teamLeadAssignments = await this.userRoleModel
        .find({ roleId: 'TEAM_LEAD' })
        .select('userId')
        .lean()
        .exec();
      const userIds = teamLeadAssignments.map((a) => a.userId);
      if (userIds.length > 0) {
        await this.notifications.createForUsers({
          recipientUserIds: userIds,
          type,
          title,
          message,
          eventKey: `${type}:${resourceId || Date.now()}`,
          resourceType: 'TEMPORARY_ROLE',
          resourceId,
          link: '/rbac/temporary-roles?tab=requests',
        });
      }
    } catch {
      // Non-blocking notification delivery
    }
  }

  async getEligibleStaff(actorUserId: string, query: EligibleStaffQueryDto) {
    const now = new Date();
    const userDocs = await this.userModel.find().exec();

    const userRoleDocs = this.userRoleModel
      ? await this.userRoleModel.find().exec()
      : [];
    const rolesByUser = new Map<string, string[]>();
    for (const ur of userRoleDocs) {
      const uId = String(ur.userId);
      const existing = rolesByUser.get(uId) || [];
      existing.push(ur.roleId);
      rolesByUser.set(uId, existing);
    }

    const activeTempRoles = await this.tempRoleModel
      .find({ status: 'ACTIVE', expiresAt: { $gt: now } })
      .exec();
    const activeByUserId = new Map<string, TemporaryRoleDocument>();
    for (const tr of activeTempRoles) {
      activeByUserId.set(String(tr.userId), tr);
    }

    const pendingRequests = await this.tempRoleModel
      .find({ requestStatus: 'PENDING' })
      .exec();
    const pendingByUserId = new Map<string, TemporaryRoleDocument>();
    for (const pr of pendingRequests) {
      pendingByUserId.set(String(pr.userId), pr);
    }

    const teams = this.teamModel ? await this.teamModel.find().exec() : [];
    const teamByUser = new Map<string, { teamName: string; department: string }>();
    for (const t of teams) {
      const members = [...(t.memberIds || []), ...(t.managerIds || [])];
      let dept = 'Modernization Operations';
      if (t.kind === 'CONVERSION' || /conversion/i.test(t.name)) dept = 'Modernization Engineering';
      else if (t.kind === 'SALES' || /sales/i.test(t.name)) dept = 'Sales & Commercial';
      else if (/qa|test|quality/i.test(t.name)) dept = 'Quality Assurance';
      else if (/support/i.test(t.name)) dept = 'Customer Support';
      else if (/platform|infra/i.test(t.name)) dept = 'Platform Architecture';

      for (const m of members) {
        if (!teamByUser.has(String(m))) {
          teamByUser.set(String(m), { teamName: t.name, department: dept });
        }
      }
    }

    const allItems: any[] = [];
    const allDepartments = new Set<string>();
    const allRoleNames = new Set<string>();

    for (const u of userDocs) {
      if ((u as any).accountType === 'PROSPECT') continue;

      const uid = u._id.toString();
      const currentRoles = rolesByUser.get(uid) || [];
      if (u.isPlatformAdmin && !currentRoles.includes('ADMIN')) {
        currentRoles.push('ADMIN');
      }

      let department = teamByUser.get(uid)?.department;
      const assignedTeam = teamByUser.get(uid)?.teamName || 'Modernization Operations Team';
      if (!department) {
        if (currentRoles.some((r) => /conversion/i.test(r))) {
          department = 'Modernization Engineering';
        } else if (currentRoles.some((r) => /lead/i.test(r))) {
          department = 'Operations Management';
        } else if (currentRoles.some((r) => /support/i.test(r))) {
          department = 'Customer Support';
        } else if (currentRoles.some((r) => /sales/i.test(r))) {
          department = 'Commercial Sales';
        } else if (u.isPlatformAdmin) {
          department = 'Executive Administration';
        } else {
          department = 'Platform Operations';
        }
      }
      allDepartments.add(department);
      currentRoles.forEach((r) => allRoleNames.add(r));

      let accountStatus: 'ACTIVE' | 'LOCKED' | 'DEACTIVATED' = 'ACTIVE';
      if (u.isLocked) {
        accountStatus = 'LOCKED';
      } else if (!u.isActive) {
        accountStatus = 'DEACTIVATED';
      }

      const activeTr = activeByUserId.get(uid);
      const pendingPr = pendingByUserId.get(uid);

      let isEligible = true;
      let ineligibilityReason: string | null = null;

      if (uid === actorUserId) {
        isEligible = false;
        ineligibilityReason = 'Cannot grant temporary role to yourself (Separation of Duties)';
      } else if (u.isPlatformAdmin) {
        isEligible = false;
        ineligibilityReason = 'Platform Admin already possesses full platform privileges';
      } else if (accountStatus === 'LOCKED') {
        isEligible = false;
        ineligibilityReason = `Account is locked: ${(u as any).lockReason || 'Security Hold'}`;
      } else if (accountStatus === 'DEACTIVATED') {
        isEligible = false;
        ineligibilityReason = 'Account is currently deactivated';
      } else if (activeTr) {
        isEligible = false;
        ineligibilityReason = `User holds active temporary elevation: ${activeTr.roleId}`;
      } else if (pendingPr) {
        isEligible = false;
        ineligibilityReason = `User has pending elevation request for ${pendingPr.roleId} awaiting review`;
      }

      allItems.push({
        id: uid,
        fullName: u.fullName || 'Internal Staff',
        email: u.email,
        employeeId: `EMP-${uid.slice(-6).toUpperCase()}`,
        department,
        assignedTeam,
        currentRoles,
        accountStatus,
        isEligible,
        ineligibilityReason,
        hasActiveTemporaryRole: Boolean(activeTr),
        activeTemporaryRole: activeTr
          ? {
              roleId: activeTr.roleId,
              expiresAt: activeTr.expiresAt.toISOString(),
              durationHours: activeTr.durationHours,
            }
          : undefined,
        hasPendingRequest: Boolean(pendingPr),
        pendingRequest: pendingPr
          ? {
              roleId: pendingPr.roleId,
              requestedAt: (pendingPr as any).createdAt?.toISOString() || now.toISOString(),
              durationHours: pendingPr.durationHours,
            }
          : undefined,
      });
    }

    let filtered = allItems;
    if (query.search && query.search.trim()) {
      const q = query.search.trim().toLowerCase();
      filtered = filtered.filter(
        (i) =>
          i.fullName.toLowerCase().includes(q) ||
          i.email.toLowerCase().includes(q) ||
          i.employeeId.toLowerCase().includes(q) ||
          i.id.toLowerCase().includes(q),
      );
    }
    if (query.department && query.department !== 'ALL') {
      filtered = filtered.filter((i) => i.department.toLowerCase() === query.department?.toLowerCase());
    }
    if (query.currentRole && query.currentRole !== 'ALL') {
      filtered = filtered.filter((i) =>
        i.currentRoles.some((r: string) => r.toLowerCase() === query.currentRole?.toLowerCase()),
      );
    }
    if (query.accountStatus && query.accountStatus !== 'ALL') {
      filtered = filtered.filter((i) => i.accountStatus === query.accountStatus);
    }
    if (query.eligibility && query.eligibility !== 'ALL') {
      const wantEligible = query.eligibility === 'ELIGIBLE';
      filtered = filtered.filter((i) => i.isEligible === wantEligible);
    }

    filtered.sort((a, b) => {
      if (a.isEligible !== b.isEligible) {
        return a.isEligible ? -1 : 1;
      }
      return a.fullName.localeCompare(b.fullName);
    });

    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(query.limit) || 10));
    const total = filtered.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const paginatedItems = filtered.slice((page - 1) * limit, page * limit);

    return {
      items: paginatedItems,
      total,
      page,
      limit,
      totalPages,
      departmentOptions: Array.from(allDepartments).sort(),
      roleOptions: Array.from(allRoleNames).sort(),
    };
  }

  async getStaffElevationProfile(staffId: string) {
    const user = await this.userModel.findById(toValidObjectId(staffId)).exec();
    if (!user) {
      throw new NotFoundException(`Staff user '${staffId}' was not found`);
    }

    const now = new Date();
    const userObjId = toValidObjectId(staffId);

    const userRoles = this.userRoleModel
      ? await this.userRoleModel.find({ userId: staffId }).exec()
      : [];
    const roles = userRoles.map((ur) => ur.roleId);
    if (user.isPlatformAdmin && !roles.includes('ADMIN')) {
      roles.push('ADMIN');
    }

    let permissionsSummary: string[] = [];
    if (this.effectivePermissionsService) {
      permissionsSummary = await this.effectivePermissionsService.getEffectivePermissions(staffId);
    } else if (this.rbacRepo) {
      permissionsSummary = await this.rbacRepo.findRolePermissionsByRoleIds(roles);
    }

    const activeTempRoles = await this.tempRoleModel
      .find({ userId: userObjId, status: 'ACTIVE', expiresAt: { $gt: now } })
      .exec();

    const pendingRequests = await this.tempRoleModel
      .find({ userId: userObjId, requestStatus: 'PENDING' })
      .exec();

    const recentHistory = await this.tempRoleModel
      .find({ userId: userObjId })
      .sort({ createdAt: -1 })
      .limit(5)
      .exec();

    const ineligibilityReasons: string[] = [];
    if (user.isPlatformAdmin) ineligibilityReasons.push('Platform Admin already holds all permissions');
    if (user.isLocked) ineligibilityReasons.push(`Account locked: ${user.lockReason || 'Security Hold'}`);
    if (!user.isActive) ineligibilityReasons.push('Account deactivated');
    if (activeTempRoles.length > 0) ineligibilityReasons.push(`Holds active temporary role: ${activeTempRoles[0].roleId}`);
    if (pendingRequests.length > 0) ineligibilityReasons.push(`Has pending elevation request for ${pendingRequests[0].roleId}`);

    return {
      staff: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        employeeId: `EMP-${user.id.slice(-6).toUpperCase()}`,
        isPlatformAdmin: user.isPlatformAdmin,
        isActive: user.isActive,
        isLocked: user.isLocked,
        accountStatus: user.isLocked ? 'LOCKED' : (!user.isActive ? 'DEACTIVATED' : 'ACTIVE'),
        currentRoles: roles,
      },
      permissionsSummary,
      activeTemporaryRoles: activeTempRoles.map((tr) => ({
        id: tr.id,
        roleId: tr.roleId,
        durationHours: tr.durationHours,
        grantedAt: tr.grantedAt?.toISOString(),
        expiresAt: tr.expiresAt?.toISOString(),
        remainingMinutes: Math.max(0, Math.round((tr.expiresAt.getTime() - now.getTime()) / 60000)),
        reason: tr.reason,
      })),
      pendingRequests: pendingRequests.map((pr) => ({
        id: pr.id,
        roleId: pr.roleId,
        durationHours: pr.durationHours,
        requestedAt: (pr as any).createdAt?.toISOString(),
        reason: pr.reason,
      })),
      recentHistory: recentHistory.map((h) => ({
        id: h.id,
        roleId: h.roleId,
        status: h.status,
        durationHours: h.durationHours,
        createdAt: (h as any).createdAt?.toISOString(),
      })),
      isEligible: ineligibilityReasons.length === 0,
      ineligibilityReasons,
    };
  }

  async getElevationCatalog() {
    const roles = await this.roleModel.find().exec();
    const catalog: any[] = [];

    const roleMetadata: Record<string, { label: string; desc: string; modules: string[] }> = {
      TEAM_LEAD: {
        label: 'Team Lead',
        desc: 'Supervisory role with assignment authority, transfer sign-offs, and quality approvals.',
        modules: ['Operations', 'Team Lead Projects', 'Resource Transfers', 'Quality Review', 'Performance Monitoring'],
      },
      CONVERSION_STAFF: {
        label: 'Conversion Staff',
        desc: 'Core modernization engineer role with AST inspection, method mapping, and batch conversion queue processing.',
        modules: ['Operations', 'Conversion Queue', 'Rule & AI Validation', 'Quality Review'],
      },
      INTERNAL_SUPPORT: {
        label: 'Internal Support',
        desc: 'Support diagnostics role with partner session replay and read-only diagnostics.',
        modules: ['Support Portal', 'Diagnostics', 'Organisations Support View'],
      },
      SALES_MANAGER: {
        label: 'Sales Manager',
        desc: 'Commercial sales elevation for quote authoring and client proposal management.',
        modules: ['CRM & Sales', 'Leads', 'Pipeline', 'Enterprise Quotes'],
      },
    };

    for (const r of roles) {
      const normalized = (r.id || '').toUpperCase();
      if (PLATFORM_ADMIN_ROLES.has(normalized)) continue;

      let permissions: string[] = [];
      if (this.rbacRepo) {
        permissions = await this.rbacRepo.findRolePermissions(r.id);
      }

      const meta = roleMetadata[normalized] || {
        label: r.name || r.id,
        desc: r.description || 'Specialized role for temporary privilege elevation.',
        modules: ['Operations', 'Modernization'],
      };

      const sensitivePermissions = permissions.filter((p) =>
        /revoke|delete|manage|grant|impersonate|override|admin/i.test(p),
      );

      catalog.push({
        id: r.id,
        code: r.id,
        name: meta.label,
        description: meta.desc,
        permissionCount: permissions.length,
        permissions,
        modules: meta.modules,
        sensitivePermissions,
      });
    }

    if (catalog.length === 0) {
      catalog.push(
        {
          id: 'team_lead',
          code: 'TEAM_LEAD',
          name: 'Team Lead',
          description: 'Supervisory role with assignment authority, transfer sign-offs, and quality approvals.',
          permissionCount: 8,
          permissions: ['team-lead.projects.manage', 'projects.allocate', 'quality.review'],
          modules: ['Operations', 'Team Lead Projects', 'Resource Transfers', 'Quality Review'],
          sensitivePermissions: ['projects.allocate', 'quality.review'],
        },
        {
          id: 'conversion_staff',
          code: 'CONVERSION_STAFF',
          name: 'Conversion Staff',
          description: 'Core modernization engineer role with AST inspection, method mapping, and batch conversion queue processing.',
          permissionCount: 6,
          permissions: ['conversions.queue.view', 'conversions.execute', 'validation.rules.view'],
          modules: ['Operations', 'Conversion Queue', 'Rule & AI Validation'],
          sensitivePermissions: ['conversions.execute'],
        },
        {
          id: 'internal_support',
          code: 'INTERNAL_SUPPORT',
          name: 'Internal Support',
          description: 'Support diagnostics role with customer diagnostics and session investigation access.',
          permissionCount: 4,
          permissions: ['support.view', 'support.diagnostics.view'],
          modules: ['Support Portal', 'Diagnostics'],
          sensitivePermissions: ['support.diagnostics.view'],
        },
      );
    }

    return catalog;
  }

}
