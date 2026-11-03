import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'node:crypto';
import { Model, Types } from 'mongoose';
import {
  SUPPORT_STAFF_PERMISSION,
  SUPPORT_STAFF_ROLE,
  SupportStaffAuthority,
  SupportStaffAuthorityPort,
} from '../domain/support-staff-authority.port';
import { Role } from './schemas/role.schema';
import { Permission } from './schemas/permission.schema';
import { RolePermission } from './schemas/role-permission.schema';
import { UserRole } from './schemas/user-role.schema';
import { TemporaryRole } from './schemas/temporary-role.schema';
import { isValidDate } from '../../../shared/utils/date.util';

/** Reads the owning RBAC collections directly without the general Admin expansion/fallback. */
@Injectable()
export class MongoSupportStaffAuthorityReader implements SupportStaffAuthorityPort {
  constructor(
    @InjectModel(Role.name) private readonly roles: Model<Role>,
    @InjectModel(Permission.name) private readonly permissions: Model<Permission>,
    @InjectModel(RolePermission.name) private readonly grants: Model<RolePermission>,
    @InjectModel(UserRole.name) private readonly assignments: Model<UserRole>,
    @InjectModel(TemporaryRole.name) private readonly temporary: Model<TemporaryRole>,
  ) {}

  async current(userId: string, now: Date): Promise<SupportStaffAuthority | null> {
    if (!/^[a-f0-9]{24}$/.test(userId)) return null;
    const [roles, permissions, grants, permanent, temporary] = await Promise.all([
      this.roles.find({ id: SUPPORT_STAFF_ROLE }).limit(2).lean().read('primary').exec(),
      this.permissions
        .find({ key: SUPPORT_STAFF_PERMISSION })
        .limit(2)
        .lean()
        .read('primary')
        .exec(),
      this.grants
        .find({ roleId: SUPPORT_STAFF_ROLE, permissionKey: SUPPORT_STAFF_PERMISSION })
        .limit(2)
        .lean()
        .read('primary')
        .exec(),
      this.assignments
        .find({ userId, roleId: SUPPORT_STAFF_ROLE })
        .limit(2)
        .lean()
        .read('primary')
        .exec(),
      this.temporary
        .find({
          userId: new Types.ObjectId(userId),
          roleId: SUPPORT_STAFF_ROLE,
          status: 'ACTIVE',
          expiresAt: { $gt: now },
        })
        .limit(2)
        .lean()
        .read('primary')
        .exec(),
    ]);
    if (
      roles.length !== 1 ||
      roles[0].isSystem !== true ||
      permissions.length !== 1 ||
      grants.length !== 1 ||
      permanent.length + temporary.length !== 1
    )
      return null;
    const grant = temporary[0];
    if (
      grant &&
      (grant.requestStatus !== 'APPROVED' ||
        grant.revokedAt != null ||
        !isValidDate(grant.grantedAt) ||
        grant.grantedAt.getTime() > now.getTime() ||
        !isValidDate(grant.expiresAt))
    )
      return null;
    // Replacement/regrant and temporary-role review mutations invalidate old contexts.
    const source = grant ?? permanent[0];
    const stamp = (doc: object) => {
      const value = doc as { _id: Types.ObjectId; updatedAt?: Date };
      return [String(value._id), value.updatedAt?.toISOString() ?? null];
    };
    return {
      binding: createHash('sha256')
        .update(
          JSON.stringify([stamp(roles[0]), stamp(permissions[0]), stamp(grants[0]), stamp(source)]),
        )
        .digest('hex'),
      ...(grant ? { expiresAt: new Date(grant.expiresAt) } : {}),
    };
  }
}
