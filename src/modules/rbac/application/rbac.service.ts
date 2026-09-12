import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
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

  async getRoles(): Promise<any[]> {
    const roles = await this.roleModel.find().exec();
    const allRps = await this.rolePermissionModel.find().exec();
    const permCounts = new Map<string, number>();
    for (const rp of allRps) {
      permCounts.set(rp.roleId, (permCounts.get(rp.roleId) || 0) + 1);
    }

    return roles.map((r) => {
      const obj = r.toObject();
      return {
        ...obj,
        id: r.id,
        key: r.id,
        permissionCount: permCounts.get(r.id) || 0,
      };
    });
  }

  async getRoleById(id: string): Promise<any> {
    const role = await this.roleModel.findOne({ id }).exec();
    if (!role) {
      throw new NotFoundException({ code: 'ROLE_NOT_FOUND', message: `Role '${id}' not found` });
    }
    const permissions = await this.getRolePermissions(id);
    const obj = role.toObject();
    return {
      ...obj,
      id: role.id,
      key: role.id,
      permissions,
      permissionCount: permissions.length,
    };
  }

  async createRole(rawKey: string, name: string, description?: string): Promise<any> {
    if (!rawKey || !rawKey.trim()) {
      throw new BadRequestException({ code: 'ROLE_KEY_REQUIRED', message: 'Role key is required' });
    }
    const normalizedKey = rawKey.trim().toUpperCase().replace(/\s+/g, '_');
    const existing = await this.roleModel.findOne({ id: normalizedKey }).exec();
    if (existing) {
      throw new ConflictException({ code: 'ROLE_ALREADY_EXISTS', message: `Role '${normalizedKey}' already exists` });
    }
    const role = new this.roleModel({
      id: normalizedKey,
      name: name.trim(),
      description: description ? description.trim() : '',
      isSystem: false,
    });
    const saved = await role.save();
    const obj = saved.toObject();
    return {
      ...obj,
      id: saved.id,
      key: saved.id,
      permissionCount: 0,
    };
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
      throw new ForbiddenException({ code: 'CANNOT_DELETE_SYSTEM_ROLE', message: `System role '${id}' cannot be deleted` });
    }
    const userCount = await this.userRoleModel.countDocuments({ roleId: id }).exec();
    if (userCount > 0) {
      throw new ConflictException({ code: 'ROLE_IN_USE', message: `Role '${id}' is assigned to users and cannot be deleted` });
    }
    await this.roleModel.deleteOne({ id }).exec();
    await this.rolePermissionModel.deleteMany({ roleId: id }).exec();
    await this.userRoleModel.deleteMany({ roleId: id }).exec();
  }

  async getPermissions(): Promise<Permission[]> {
    return this.permissionModel.find().exec();
  }

  async createPermission(key: string, label: string, group: string, description?: string): Promise<Permission> {
    if (!key || !key.trim()) {
      throw new BadRequestException({ code: 'PERMISSION_KEY_REQUIRED', message: 'Permission key is required' });
    }
    const normalizedKey = key.trim().toLowerCase().replace(/\s+/g, '.');
    const existing = await this.permissionModel.findOne({ key: normalizedKey }).exec();
    if (existing) {
      throw new ConflictException({ code: 'PERMISSION_ALREADY_EXISTS', message: `Permission '${normalizedKey}' already exists` });
    }
    const perm = new this.permissionModel({
      key: normalizedKey,
      label: label.trim(),
      group: group.trim(),
      description: description ? description.trim() : '',
    });
    return perm.save();
  }

  async updatePermission(key: string, label?: string, group?: string, description?: string): Promise<Permission> {
    const perm = await this.permissionModel.findOne({ key }).exec();
    if (!perm) {
      throw new NotFoundException({ code: 'PERMISSION_NOT_FOUND', message: `Permission '${key}' not found` });
    }
    if (label !== undefined) perm.label = label.trim();
    if (group !== undefined) perm.group = group.trim();
    if (description !== undefined) perm.description = description.trim();
    return perm.save();
  }

  async deletePermission(key: string): Promise<void> {
    const perm = await this.permissionModel.findOne({ key }).exec();
    if (!perm) {
      throw new NotFoundException({ code: 'PERMISSION_NOT_FOUND', message: `Permission '${key}' not found` });
    }
    await this.permissionModel.deleteOne({ key }).exec();
    await this.rolePermissionModel.deleteMany({ permissionKey: key }).exec();
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

    const uniqueKeys = Array.from(new Set(permissionKeys));

    // Validate ALL permission keys exist. If any key is invalid, reject entire request with 400.
    if (uniqueKeys.length > 0) {
      const validPerms = await this.permissionModel.find({ key: { $in: uniqueKeys } }).exec();
      if (validPerms.length !== uniqueKeys.length) {
        throw new BadRequestException({ code: 'INVALID_PERMISSIONS', message: 'One or more permission keys are invalid' });
      }
    }

    await this.rolePermissionModel.deleteMany({ roleId }).exec();
    if (uniqueKeys.length > 0) {
      const docs = uniqueKeys.map((key) => ({ roleId, permissionKey: key }));
      await this.rolePermissionModel.insertMany(docs);
    }

    return uniqueKeys;
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
