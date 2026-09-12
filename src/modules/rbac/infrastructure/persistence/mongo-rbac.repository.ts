import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Role, RoleDocument } from '../schemas/role.schema';
import { Permission, PermissionDocument } from '../schemas/permission.schema';
import { RolePermission, RolePermissionDocument } from '../schemas/role-permission.schema';
import { UserRole, UserRoleDocument } from '../schemas/user-role.schema';
import { User, UserDocument } from '../../../users/infrastructure/user.schema';
import { IRbacRepository, IRole, IPermission, IRbacUser } from '../../domain/rbac.repository.interface';

@Injectable()
export class MongoRbacRepository implements IRbacRepository {
  constructor(
    @InjectModel(Role.name) private readonly roleModel: Model<RoleDocument>,
    @InjectModel(Permission.name) private readonly permissionModel: Model<PermissionDocument>,
    @InjectModel(RolePermission.name) private readonly rolePermissionModel: Model<RolePermissionDocument>,
    @InjectModel(UserRole.name) private readonly userRoleModel: Model<UserRoleDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  async findRoles(): Promise<IRole[]> {
    const docs = await this.roleModel.find().exec();
    return docs.map((d) => ({
      id: d.id,
      name: d.name,
      description: d.description,
      isSystem: d.isSystem,
      createdAt: (d as any).createdAt,
      updatedAt: (d as any).updatedAt,
    }));
  }

  async findRoleById(id: string): Promise<IRole | null> {
    const d = await this.roleModel.findOne({ id }).exec();
    if (!d) return null;
    return {
      id: d.id,
      name: d.name,
      description: d.description,
      isSystem: d.isSystem,
      createdAt: (d as any).createdAt,
      updatedAt: (d as any).updatedAt,
    };
  }

  async createRole(data: { id: string; name: string; description: string; isSystem: boolean }): Promise<IRole> {
    const created = new this.roleModel(data);
    const saved = await created.save();
    return {
      id: saved.id,
      name: saved.name,
      description: saved.description,
      isSystem: saved.isSystem,
      createdAt: (saved as any).createdAt,
      updatedAt: (saved as any).updatedAt,
    };
  }

  async updateRole(id: string, data: { name?: string; description?: string }): Promise<IRole | null> {
    const role = await this.roleModel.findOne({ id }).exec();
    if (!role) return null;
    if (data.name !== undefined) role.name = data.name;
    if (data.description !== undefined) role.description = data.description;
    const saved = await role.save();
    return {
      id: saved.id,
      name: saved.name,
      description: saved.description,
      isSystem: saved.isSystem,
      createdAt: (saved as any).createdAt,
      updatedAt: (saved as any).updatedAt,
    };
  }

  async deleteRole(id: string): Promise<void> {
    await this.roleModel.deleteOne({ id }).exec();
  }

  async countUsersWithRole(roleId: string): Promise<number> {
    return this.userRoleModel.countDocuments({ roleId }).exec();
  }

  async deleteRolePermissionsByRoleId(roleId: string): Promise<void> {
    await this.rolePermissionModel.deleteMany({ roleId }).exec();
  }

  async deleteUserRolesByRoleId(roleId: string): Promise<void> {
    await this.userRoleModel.deleteMany({ roleId }).exec();
  }

  async findPermissions(): Promise<IPermission[]> {
    const docs = await this.permissionModel.find().exec();
    return docs.map((d) => ({
      key: d.key,
      label: d.label,
      group: d.group,
      description: d.description,
      createdAt: (d as any).createdAt,
      updatedAt: (d as any).updatedAt,
    }));
  }

  async findPermissionByKey(key: string): Promise<IPermission | null> {
    const d = await this.permissionModel.findOne({ key }).exec();
    if (!d) return null;
    return {
      key: d.key,
      label: d.label,
      group: d.group,
      description: d.description,
      createdAt: (d as any).createdAt,
      updatedAt: (d as any).updatedAt,
    };
  }

  async createPermission(data: { key: string; label: string; group: string; description: string }): Promise<IPermission> {
    const created = new this.permissionModel(data);
    const saved = await created.save();
    return {
      key: saved.key,
      label: saved.label,
      group: saved.group,
      description: saved.description,
      createdAt: (saved as any).createdAt,
      updatedAt: (saved as any).updatedAt,
    };
  }

  async updatePermission(key: string, data: { label?: string; group?: string; description?: string }): Promise<IPermission | null> {
    const perm = await this.permissionModel.findOne({ key }).exec();
    if (!perm) return null;
    if (data.label !== undefined) perm.label = data.label;
    if (data.group !== undefined) perm.group = data.group;
    if (data.description !== undefined) perm.description = data.description;
    const saved = await perm.save();
    return {
      key: saved.key,
      label: saved.label,
      group: saved.group,
      description: saved.description,
      createdAt: (saved as any).createdAt,
      updatedAt: (saved as any).updatedAt,
    };
  }

  async deletePermission(key: string): Promise<void> {
    await this.permissionModel.deleteOne({ key }).exec();
  }

  async deleteRolePermissionsByPermissionKey(permissionKey: string): Promise<void> {
    await this.rolePermissionModel.deleteMany({ permissionKey }).exec();
  }

  async findRolePermissions(roleId: string): Promise<string[]> {
    const rps = await this.rolePermissionModel.find({ roleId }).exec();
    return rps.map((rp) => rp.permissionKey);
  }

  async findRolePermissionsByRoleIds(roleIds: string[]): Promise<string[]> {
    const rps = await this.rolePermissionModel.find({ roleId: { $in: roleIds } }).select('permissionKey').exec();
    return rps.map((rp) => rp.permissionKey);
  }

  async findAllRolePermissions(): Promise<Array<{ roleId: string; permissionKey: string }>> {
    const rps = await this.rolePermissionModel.find().exec();
    return rps.map((rp) => ({ roleId: rp.roleId, permissionKey: rp.permissionKey }));
  }

  async updateRolePermissions(roleId: string, permissionKeys: string[]): Promise<string[]> {
    await this.rolePermissionModel.deleteMany({ roleId }).exec();
    if (permissionKeys.length > 0) {
      const docs = permissionKeys.map((key) => ({ roleId, permissionKey: key }));
      await this.rolePermissionModel.insertMany(docs);
    }
    return permissionKeys;
  }

  async findUserRoles(userId: string): Promise<string[]> {
    const urs = await this.userRoleModel.find({ userId }).select('roleId').exec();
    return urs.map((ur) => ur.roleId);
  }

  async findAllUserRoles(): Promise<Array<{ userId: string; roleId: string }>> {
    const urs = await this.userRoleModel.find().exec();
    return urs.map((ur) => ({ userId: ur.userId, roleId: ur.roleId }));
  }

  async updateUserRoles(userId: string, roleIds: string[]): Promise<string[]> {
    await this.userRoleModel.deleteMany({ userId }).exec();
    if (roleIds.length > 0) {
      const docs = roleIds.map((roleId) => ({ userId, roleId }));
      await this.userRoleModel.insertMany(docs);
    }
    return roleIds;
  }

  async findUserById(userId: string): Promise<IRbacUser | null> {
    const u = await this.userModel.findById(userId).exec();
    if (!u) return null;
    return {
      id: u.id || u._id.toString(),
      email: u.email,
      fullName: u.fullName,
      isPlatformAdmin: u.isPlatformAdmin,
      isActive: u.isActive,
    };
  }

  async findAllUsers(): Promise<IRbacUser[]> {
    const users = await this.userModel.find().select('email fullName isPlatformAdmin isActive').exec();
    return users.map((u) => ({
      id: u.id || u._id.toString(),
      email: u.email,
      fullName: u.fullName,
      isPlatformAdmin: u.isPlatformAdmin,
      isActive: u.isActive,
    }));
  }

  async findValidPermissions(keys: string[]): Promise<string[]> {
    const docs = await this.permissionModel.find({ key: { $in: keys } }).select('key').exec();
    return docs.map((d) => d.key);
  }

  async findValidRoles(ids: string[]): Promise<string[]> {
    const docs = await this.roleModel.find({ id: { $in: ids } }).select('id').exec();
    return docs.map((d) => d.id);
  }
}
