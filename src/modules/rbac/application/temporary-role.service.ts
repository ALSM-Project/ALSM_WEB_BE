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
  ) {
    if (durationHours <= 0 || durationHours > 24) {
      throw new BadRequestException('Temporary role duration must be between 1 and 24 hours');
    }

    const normalizedRole = roleId.toUpperCase().trim();
    if (normalizedRole === 'SYSTEM_ADMIN' || normalizedRole === 'ADMIN' || normalizedRole === 'PLATFORM_ADMIN') {
      throw new ForbiddenException('Temporary role cannot grant Platform Admin privileges');
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
      reason,
      requestStatus: 'APPROVED',
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
        reason,
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

    doc.status = 'REVOKED';
    doc.revokedAt = new Date();
    doc.revokedBy = toValidObjectId(actorUserId);
    doc.revocationReason = reason;
    await doc.save();

    await this.audit.append({
      actorUserId,
      action: 'TEMPORARY_ROLE_REVOKED',
      resourceType: 'TEMPORARY_ROLE',
      resourceId: doc.id,
      metadata: {
        userId: doc.userId.toString(),
        roleId: doc.roleId,
        reason: reason || '',
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
    if (durationHours <= 0 || durationHours > 24) {
      throw new BadRequestException('Requested duration cannot exceed 24 hours');
    }

    const normalizedRole = roleId.toUpperCase().trim();
    if (normalizedRole === 'SYSTEM_ADMIN' || normalizedRole === 'ADMIN' || normalizedRole === 'PLATFORM_ADMIN') {
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
      reason,
      requestedBy: toValidObjectId(staffUserId),
      requestStatus: 'PENDING',
    });

    await this.audit.append({
      actorUserId: staffUserId,
      action: 'TEMPORARY_ROLE_REQUESTED',
      resourceType: 'TEMPORARY_ROLE',
      resourceId: doc.id,
      metadata: { roleId: normalizedRole, durationHours: String(durationHours), reason },
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
