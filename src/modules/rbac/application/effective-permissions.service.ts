import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UserRole, UserRoleDocument } from '../infrastructure/schemas/user-role.schema';
import { Permission, PermissionDocument } from '../infrastructure/schemas/permission.schema';
import { RolePermission, RolePermissionDocument } from '../infrastructure/schemas/role-permission.schema';
import { User, UserDocument } from '../../users/infrastructure/user.schema';

@Injectable()
export class EffectivePermissionsService {
  constructor(
    @InjectModel(UserRole.name) private readonly userRoleModel: Model<UserRoleDocument>,
    @InjectModel(RolePermission.name) private readonly rolePermissionModel: Model<RolePermissionDocument>,
    @InjectModel(Permission.name) private readonly permissionModel: Model<PermissionDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  async getUserRoles(userId: string): Promise<string[]> {
    const userRoles = await this.userRoleModel.find({ userId }).select('roleId').exec();
    const roleIds = userRoles.map((ur) => ur.roleId);

    // If user is platform admin, ensure ADMIN is in roles list
    const user = await this.userModel.findById(userId).exec();
    if (user?.isPlatformAdmin && !roleIds.includes('ADMIN')) {
      roleIds.push('ADMIN');
    }

    return Array.from(new Set(roleIds));
  }

  async getEffectivePermissions(userId: string): Promise<string[]> {
    const user = await this.userModel.findById(userId).exec();
    if (user?.isPlatformAdmin) {
      const allPerms = await this.permissionModel.find().select('key').exec();
      return allPerms.map((p) => p.key);
    }

    const roleIds = await this.getUserRoles(userId);
    if (roleIds.length === 0) return [];

    const rolePermissions = await this.rolePermissionModel
      .find({ roleId: { $in: roleIds } })
      .select('permissionKey')
      .exec();

    const permissionKeys = rolePermissions.map((rp) => rp.permissionKey);
    return Array.from(new Set(permissionKeys));
  }
}
