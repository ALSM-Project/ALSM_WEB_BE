import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { TemporaryRole, TemporaryRoleDocument } from '../infrastructure/schemas/temporary-role.schema';
import { User, UserDocument } from '../../users/infrastructure/user.schema';
import { Role, RoleDocument } from '../infrastructure/schemas/role.schema';
import { AUDIT_REPOSITORY, AuditRepository } from '../../audit/domain/audit.repository';
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
  ) {}

  async grantTemporaryRole(
    actorUserId: string,
    targetUserId: string,
    roleId: string,
    durationHours: number,
    reason: string,
    projectId?: string,
  ) {
    requireValidDuration(durationHours);
    const justification = requireJustification(reason);

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
    const activeExisting = await this.tempRoleModel.findOne({
      userId: toValidObjectId(targetUserId),
      status: 'ACTIVE',
      expiresAt: { $gt: new Date() },
    }).exec();

    if (activeExisting) {
      throw new ConflictException({
        code: 'ACTIVE_TEMPORARY_ROLE_EXISTS',
        message: 'The user already holds an active temporary role',
      });
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + durationHours * 3600 * 1000);

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
      .sort({ createdAt: -1 })
      .exec();

    return docs;
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

    return doc;
  }

  async requestTemporaryRole(
    staffUserId: string,
    roleId: string,
    durationHours: number,
    reason: string,
  ) {
    requireValidDuration(durationHours);
    const justification = requireJustification(reason);

    const normalizedRole = roleId.toUpperCase().trim();
    if (PLATFORM_ADMIN_ROLES.has(normalizedRole)) {
      throw new ForbiddenException('Cannot request Platform Admin role');
    }

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

    const now = new Date();
    const expiresAt = new Date(now.getTime() + durationHours * 3600 * 1000);

    const doc = await this.tempRoleModel.create({
      userId: toValidObjectId(staffUserId),
      roleId: normalizedRole,
      grantedBy: toValidObjectId(staffUserId),
      grantedAt: now,
      expiresAt,
      durationHours,
      status: 'REVOKED', // not active until approved
      reason: justification,
      requestedBy: toValidObjectId(staffUserId),
      requestStatus: 'PENDING',
    });

    await this.audit.append({
      actorUserId: staffUserId,
      action: 'TEMPORARY_ROLE_REQUESTED',
      resourceType: 'TEMPORARY_ROLE',
      resourceId: doc.id,
      metadata: { roleId: normalizedRole, durationHours: String(durationHours), reason: justification },
    });

    return doc;
  }

  async reviewRequest(
    reviewerUserId: string,
    requestId: string,
    approved: boolean,
    reason?: string,
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
    if (!approved && !reason?.trim()) {
      throw new BadRequestException({
        code: 'REJECTION_REASON_REQUIRED',
        message: 'A reason is required to reject a request',
      });
    }
    if (approved) {
      const stillActive = await this.tempRoleModel
        .findOne({ userId: doc.userId, status: 'ACTIVE', expiresAt: { $gt: new Date() } })
        .exec();
      if (stillActive) {
        throw new ConflictException({
          code: 'ACTIVE_TEMPORARY_ROLE_EXISTS',
          message: 'The user already holds an active temporary role',
        });
      }
    }

    doc.requestStatus = approved ? 'APPROVED' : 'REJECTED';
    if (approved) {
      const now = new Date();
      doc.grantedBy = toValidObjectId(reviewerUserId);
      doc.grantedAt = now;
      doc.expiresAt = new Date(now.getTime() + doc.durationHours * 3600 * 1000);
      doc.status = 'ACTIVE';
    } else {
      doc.status = 'REVOKED';
      doc.revocationReason = reason;
    }
    await doc.save();

    await this.audit.append({
      actorUserId: reviewerUserId,
      action: approved ? 'TEMPORARY_ROLE_REQUEST_APPROVED' : 'TEMPORARY_ROLE_REQUEST_REJECTED',
      resourceType: 'TEMPORARY_ROLE',
      resourceId: doc.id,
      metadata: { approved: String(approved), reason: reason || '' },
    });

    return doc;
  }

  async getHistory() {
    return this.tempRoleModel
      .find()
      .populate('userId', 'fullName email')
      .populate('grantedBy', 'fullName email')
      .sort({ createdAt: -1 })
      .exec();
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
}
