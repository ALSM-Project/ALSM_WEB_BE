import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Role, RoleDocument } from '../infrastructure/schemas/role.schema';
import { Permission, PermissionDocument } from '../infrastructure/schemas/permission.schema';
import { RolePermission, RolePermissionDocument } from '../infrastructure/schemas/role-permission.schema';
import { UserRole, UserRoleDocument } from '../infrastructure/schemas/user-role.schema';
import { User, UserDocument } from '../../users/infrastructure/user.schema';

@Injectable()
export class RbacService {
  constructor(
    @InjectModel(Role.name) private readonly roleModel: Model<RoleDocument>,
    @InjectModel(Permission.name) private readonly permissionModel: Model<PermissionDocument>,
    @InjectModel(RolePermission.name) private readonly rolePermissionModel: Model<RolePermissionDocument>,
    @InjectModel(UserRole.name) private readonly userRoleModel: Model<UserRoleDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  async getRoles(): Promise<Role[]> {
    return this.roleModel.find().exec();
  }

  async createRole(id: string, name: string, description?: string): Promise<Role> {
    const normalizedId = id.trim().toUpperCase().replace(/\s+/g, '_');
    const existing = await this.roleModel.findOne({ id: normalizedId }).exec();
    if (existing) {
      throw new ConflictException({ code: 'ROLE_ALREADY_EXISTS', message: `Role '${normalizedId}' already exists` });
    }
    const role = new this.roleModel({
      id: normalizedId,
      name: name.trim(),
      description: description || '',
      isSystem: false,
    });
    return role.save();
  }

  async updateRole(id: string, name?: string, description?: string): Promise<Role> {
    const role = await this.roleModel.findOne({ id }).exec();
    if (!role) {
      throw new NotFoundException({ code: 'ROLE_NOT_FOUND', message: `Role '${id}' not found` });
    }
    if (name !== undefined) role.name = name.trim();
    if (description !== undefined) role.description = description.trim();
    return role.save();
  }

  async deleteRole(id: string): Promise<void> {
    const role = await this.roleModel.findOne({ id }).exec();
    if (!role) {
      throw new NotFoundException({ code: 'ROLE_NOT_FOUND', message: `Role '${id}' not found` });
    }
    if (role.isSystem) {
      throw new BadRequestException({ code: 'CANNOT_DELETE_SYSTEM_ROLE', message: `System role '${id}' cannot be deleted` });
    }
    await this.roleModel.deleteOne({ id }).exec();
    await this.rolePermissionModel.deleteMany({ roleId: id }).exec();
    await this.userRoleModel.deleteMany({ roleId: id }).exec();
  }

  async getPermissions(): Promise<Permission[]> {
    return this.permissionModel.find().exec();
  }

  async getRolePermissions(roleId: string): Promise<string[]> {
    const rps = await this.rolePermissionModel.find({ roleId }).exec();
    return rps.map((rp) => rp.permissionKey);
  }

  async updateRolePermissions(roleId: string, permissionKeys: string[]): Promise<string[]> {
    const role = await this.roleModel.findOne({ id: roleId }).exec();
    if (!role) {
      throw new NotFoundException({ code: 'ROLE_NOT_FOUND', message: `Role '${roleId}' not found` });
    }

    // Validate permission keys exist
    const validPerms = await this.permissionModel.find({ key: { $in: permissionKeys } }).exec();
    const validKeys = validPerms.map((p) => p.key);

    await this.rolePermissionModel.deleteMany({ roleId }).exec();
    if (validKeys.length > 0) {
      const docs = validKeys.map((key) => ({ roleId, permissionKey: key }));
      await this.rolePermissionModel.insertMany(docs);
    }

    return validKeys;
  }

  async getUserRoles(userId: string): Promise<string[]> {
    const urs = await this.userRoleModel.find({ userId }).exec();
    return urs.map((ur) => ur.roleId);
  }

  async updateUserRoles(userId: string, roleIds: string[]): Promise<string[]> {
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: `User '${userId}' not found` });
    }

    // Validate roleIds exist
    const validRoles = await this.roleModel.find({ id: { $in: roleIds } }).exec();
    const validRoleIds = validRoles.map((r) => r.id);

    await this.userRoleModel.deleteMany({ userId }).exec();
    if (validRoleIds.length > 0) {
      const docs = validRoleIds.map((rId) => ({ userId, roleId: rId }));
      await this.userRoleModel.insertMany(docs);
    }

    return validRoleIds;
  }

  async getAllUsers(): Promise<Array<{ id: string; email: string; fullName: string; isPlatformAdmin: boolean; roles: string[] }>> {
    const users = await this.userModel.find().select('email fullName isPlatformAdmin isActive').exec();
    const allUserRoles = await this.userRoleModel.find().exec();

    const userRolesMap = new Map<string, string[]>();
    for (const ur of allUserRoles) {
      const existing = userRolesMap.get(ur.userId) || [];
      existing.push(ur.roleId);
      userRolesMap.set(ur.userId, existing);
    }

    return users.map((u) => {
      const uId = u.id || u._id.toString();
      const roles = userRolesMap.get(uId) || [];
      if (u.isPlatformAdmin && !roles.includes('ADMIN')) roles.push('ADMIN');
      return {
        id: uId,
        email: u.email,
        fullName: u.fullName,
        isPlatformAdmin: u.isPlatformAdmin,
        roles,
      };
    });
  }
}
