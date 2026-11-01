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
    const doc = await this.tempRoleModel.findById(toValidObjectId(id)).exec();
    if (!doc) {
      throw new NotFoundException('Temporary role was not found');
    }
    if (doc.status !== 'ACTIVE') {
      throw new ConflictException({
        code: 'TEMPORARY_ROLE_NOT_ACTIVE',
        message: `Only an active temporary role can be revoked; this one is ${doc.status}`,
      });
    }
    const revocationReason = reason?.trim() ?? '';
    if (!revocationReason) {
      throw new BadRequestException({
        code: 'REVOCATION_REASON_REQUIRED',
        message: 'A reason is required to revoke a temporary role',
      });
    }

    doc.status = 'REVOKED';
    doc.revokedAt = new Date();
    doc.revokedBy = toValidObjectId(actorUserId);
    doc.revocationReason = revocationReason;
    await doc.save();

    await this.audit.append({
      actorUserId,
      action: 'TEMPORARY_ROLE_REVOKED',
      resourceType: 'TEMPORARY_ROLE',
      resourceId: doc.id,
      metadata: {
        userId: doc.userId.toString(),
        roleId: doc.roleId,
        revokedAt: doc.revokedAt.toISOString(),
        reason: revocationReason,
      },
    });

    await this.notifyUser(
      doc.userId.toString(),
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
}
