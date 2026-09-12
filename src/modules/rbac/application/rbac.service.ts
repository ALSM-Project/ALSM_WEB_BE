import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { IRbacRepository, RBAC_REPOSITORY, IRole, IPermission } from '../domain/rbac.repository.interface';

@Injectable()
export class RbacService {
  constructor(
    @Inject(RBAC_REPOSITORY) private readonly rbacRepo: IRbacRepository,
  ) {}

  async getRoles(): Promise<any[]> {
    const roles = await this.rbacRepo.findRoles();
    const allRps = await this.rbacRepo.findAllRolePermissions();
    const permCounts = new Map<string, number>();
    for (const rp of allRps) {
      permCounts.set(rp.roleId, (permCounts.get(rp.roleId) || 0) + 1);
    }

    return roles.map((r) => ({
      ...r,
      id: r.id,
      key: r.id,
      permissionCount: permCounts.get(r.id) || 0,
    }));
  }

  async getRoleById(id: string): Promise<any> {
    const role = await this.rbacRepo.findRoleById(id);
    if (!role) {
      throw new NotFoundException({ code: 'ROLE_NOT_FOUND', message: `Role '${id}' not found` });
    }
    const permissions = await this.getRolePermissions(id);
    return {
      ...role,
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
    const existing = await this.rbacRepo.findRoleById(normalizedKey);
    if (existing) {
      throw new ConflictException({ code: 'ROLE_ALREADY_EXISTS', message: `Role '${normalizedKey}' already exists` });
    }
    const saved = await this.rbacRepo.createRole({
      id: normalizedKey,
      name: name.trim(),
      description: description ? description.trim() : '',
      isSystem: false,
    });
    return {
      ...saved,
      id: saved.id,
      key: saved.id,
      permissionCount: 0,
    };
  }

  async updateRole(id: string, name?: string, description?: string): Promise<IRole> {
    const role = await this.rbacRepo.findRoleById(id);
    if (!role) {
      throw new NotFoundException({ code: 'ROLE_NOT_FOUND', message: `Role '${id}' not found` });
    }
    const updated = await this.rbacRepo.updateRole(id, {
      name: name !== undefined ? name.trim() : undefined,
      description: description !== undefined ? description.trim() : undefined,
    });
    return updated!;
  }

  async deleteRole(id: string): Promise<void> {
    const role = await this.rbacRepo.findRoleById(id);
    if (!role) {
      throw new NotFoundException({ code: 'ROLE_NOT_FOUND', message: `Role '${id}' not found` });
    }
    if (role.isSystem) {
      throw new ForbiddenException({ code: 'CANNOT_DELETE_SYSTEM_ROLE', message: `System role '${id}' cannot be deleted` });
    }
    const userCount = await this.rbacRepo.countUsersWithRole(id);
    if (userCount > 0) {
      throw new ConflictException({ code: 'ROLE_IN_USE', message: `Role '${id}' is assigned to users and cannot be deleted` });
    }
    await this.rbacRepo.deleteRole(id);
    await this.rbacRepo.deleteRolePermissionsByRoleId(id);
    await this.rbacRepo.deleteUserRolesByRoleId(id);
  }

  async getPermissions(): Promise<IPermission[]> {
    return this.rbacRepo.findPermissions();
  }

  async createPermission(key: string, label: string, group: string, description?: string): Promise<IPermission> {
    if (!key || !key.trim()) {
      throw new BadRequestException({ code: 'PERMISSION_KEY_REQUIRED', message: 'Permission key is required' });
    }
    const normalizedKey = key.trim().toLowerCase().replace(/\s+/g, '.');
    const existing = await this.rbacRepo.findPermissionByKey(normalizedKey);
    if (existing) {
      throw new ConflictException({ code: 'PERMISSION_ALREADY_EXISTS', message: `Permission '${normalizedKey}' already exists` });
    }
    return this.rbacRepo.createPermission({
      key: normalizedKey,
      label: label.trim(),
      group: group.trim(),
      description: description ? description.trim() : '',
    });
  }

  async updatePermission(key: string, label?: string, group?: string, description?: string): Promise<IPermission> {
    const perm = await this.rbacRepo.findPermissionByKey(key);
    if (!perm) {
      throw new NotFoundException({ code: 'PERMISSION_NOT_FOUND', message: `Permission '${key}' not found` });
    }
    const updated = await this.rbacRepo.updatePermission(key, {
      label: label !== undefined ? label.trim() : undefined,
      group: group !== undefined ? group.trim() : undefined,
      description: description !== undefined ? description.trim() : undefined,
    });
    return updated!;
  }

  async deletePermission(key: string): Promise<void> {
    const perm = await this.rbacRepo.findPermissionByKey(key);
    if (!perm) {
      throw new NotFoundException({ code: 'PERMISSION_NOT_FOUND', message: `Permission '${key}' not found` });
    }
    await this.rbacRepo.deletePermission(key);
    await this.rbacRepo.deleteRolePermissionsByPermissionKey(key);
  }

  async getRolePermissions(roleId: string): Promise<string[]> {
    return this.rbacRepo.findRolePermissions(roleId);
  }

  async updateRolePermissions(roleId: string, permissionKeys: string[]): Promise<string[]> {
    const role = await this.rbacRepo.findRoleById(roleId);
    if (!role) {
      throw new NotFoundException({ code: 'ROLE_NOT_FOUND', message: `Role '${roleId}' not found` });
    }

    const uniqueKeys = Array.from(new Set(permissionKeys));

    if (uniqueKeys.length > 0) {
      const validPerms = await this.rbacRepo.findValidPermissions(uniqueKeys);
      if (validPerms.length !== uniqueKeys.length) {
        throw new BadRequestException({ code: 'INVALID_PERMISSIONS', message: 'One or more permission keys are invalid' });
      }
    }

    return this.rbacRepo.updateRolePermissions(roleId, uniqueKeys);
  }

  async getUserRoles(userId: string): Promise<string[]> {
    return this.rbacRepo.findUserRoles(userId);
  }

  async updateUserRoles(userId: string, roleIds: string[]): Promise<string[]> {
    const user = await this.rbacRepo.findUserById(userId);
    if (!user) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: `User '${userId}' not found` });
    }

    const validRoleIds = await this.rbacRepo.findValidRoles(roleIds);
    return this.rbacRepo.updateUserRoles(userId, validRoleIds);
  }

  async getAllUsers(): Promise<Array<{ id: string; email: string; fullName: string; isPlatformAdmin: boolean; roles: string[] }>> {
    const users = await this.rbacRepo.findAllUsers();
    const allUserRoles = await this.rbacRepo.findAllUserRoles();

    const userRolesMap = new Map<string, string[]>();
    for (const ur of allUserRoles) {
      const existing = userRolesMap.get(ur.userId) || [];
      existing.push(ur.roleId);
      userRolesMap.set(ur.userId, existing);
    }

    return users.map((u) => {
      const uId = u.id;
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
