import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  IRbacRepository,
  RBAC_REPOSITORY,
  IRole,
  IPermission,
} from '../domain/rbac.repository.interface';
import { AUDIT_REPOSITORY, AuditRepository } from '../../audit/domain/audit.repository';

export interface IRoleResponse extends IRole {
  key: string;
  permissionCount: number;
  permissions?: string[];
}

@Injectable()
export class RbacService {
  constructor(
    @Inject(RBAC_REPOSITORY) private readonly rbacRepo: IRbacRepository,
    @Optional()
    @Inject(AUDIT_REPOSITORY)
    private readonly audit?: AuditRepository,
  ) {}

  async getRoles(): Promise<IRoleResponse[]> {
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

  async getRoleById(id: string): Promise<IRoleResponse> {
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

  async createRole(
    rawKey: string,
    name: string,
    description?: string,
    isSystem: boolean = false,
    actorId?: string,
  ): Promise<IRoleResponse> {
    if (!rawKey || !rawKey.trim()) {
      throw new BadRequestException({ code: 'ROLE_KEY_REQUIRED', message: 'Role key is required' });
    }
    const normalizedKey = rawKey.trim().toUpperCase().replace(/\s+/g, '_');
    const existing = await this.rbacRepo.findRoleById(normalizedKey);
    if (existing) {
      throw new ConflictException({
        code: 'ROLE_ALREADY_EXISTS',
        message: `Role '${normalizedKey}' already exists`,
      });
    }
    const saved = await this.rbacRepo.createRole({
      id: normalizedKey,
      name: name.trim(),
      description: description ? description.trim() : '',
      isSystem,
    });

    if (this.audit) {
      await this.audit.append({
        actorUserId: actorId,
        action: 'ROLE_CREATED',
        resourceType: 'role',
        resourceId: saved.id,
        metadata: {
          name: saved.name,
          isSystem: saved.isSystem ? 'true' : 'false',
        },
      });
    }

    return {
      ...saved,
      id: saved.id,
      key: saved.id,
      permissionCount: 0,
    };
  }

  async updateRole(
    id: string,
    name?: string,
    description?: string,
    actorId?: string,
  ): Promise<IRole> {
    const role = await this.rbacRepo.findRoleById(id);
    if (!role) {
      throw new NotFoundException({ code: 'ROLE_NOT_FOUND', message: `Role '${id}' not found` });
    }
    const resolvedRoleId = role.id;
    const updated = await this.rbacRepo.updateRole(resolvedRoleId, {
      name: name !== undefined ? name.trim() : undefined,
      description: description !== undefined ? description.trim() : undefined,
    });

    if (this.audit) {
      await this.audit.append({
        actorUserId: actorId,
        action: 'ROLE_UPDATED',
        resourceType: 'role',
        resourceId: resolvedRoleId,
        metadata: {
          name: updated?.name || role.name,
        },
      });
    }

    return updated!;
  }

  async deleteRole(id: string, actorId?: string, force: boolean = false): Promise<void> {
    const role = await this.rbacRepo.findRoleById(id);
    if (!role) {
      throw new NotFoundException({ code: 'ROLE_NOT_FOUND', message: `Role '${id}' not found` });
    }
    const resolvedRoleId = role.id;
    if (!force) {
      if (role.isSystem) {
        throw new ForbiddenException({
          code: 'CANNOT_DELETE_SYSTEM_ROLE',
          message: `System role '${resolvedRoleId}' cannot be deleted`,
        });
      }
      const userCount = await this.rbacRepo.countUsersWithRole(resolvedRoleId);
      if (userCount > 0) {
        throw new ConflictException({
          code: 'ROLE_IN_USE',
          message: `Role '${resolvedRoleId}' is assigned to users and cannot be deleted`,
        });
      }
    }
    await this.rbacRepo.deleteRole(resolvedRoleId);
    await this.rbacRepo.deleteRolePermissionsByRoleId(resolvedRoleId);
    await this.rbacRepo.deleteUserRolesByRoleId(resolvedRoleId);

    if (this.audit) {
      await this.audit.append({
        actorUserId: actorId,
        action: 'ROLE_DELETED',
        resourceType: 'role',
        resourceId: id,
        metadata: { name: role.name },
      });
    }
  }

  async getPermissions(): Promise<IPermission[]> {
    return this.rbacRepo.findPermissions();
  }

  async createPermission(
    key: string,
    label: string,
    group: string,
    description?: string,
    actorId?: string,
  ): Promise<IPermission> {
    if (!key || !key.trim()) {
      throw new BadRequestException({
        code: 'PERMISSION_KEY_REQUIRED',
        message: 'Permission key is required',
      });
    }
    const normalizedKey = key.trim().toLowerCase().replace(/\s+/g, '.');
    const existing = await this.rbacRepo.findPermissionByKey(normalizedKey);
    if (existing) {
      throw new ConflictException({
        code: 'PERMISSION_ALREADY_EXISTS',
        message: `Permission '${normalizedKey}' already exists`,
      });
    }
    const perm = await this.rbacRepo.createPermission({
      key: normalizedKey,
      label: label.trim(),
      group: group.trim(),
      description: description ? description.trim() : '',
    });

    if (this.audit) {
      await this.audit.append({
        actorUserId: actorId,
        action: 'PERMISSION_CREATED',
        resourceType: 'permission',
        resourceId: perm.key,
        metadata: { label: perm.label, group: perm.group },
      });
    }

    return perm;
  }

  async updatePermission(
    key: string,
    label?: string,
    group?: string,
    description?: string,
    actorId?: string,
  ): Promise<IPermission> {
    const perm = await this.rbacRepo.findPermissionByKey(key);
    if (!perm) {
      throw new NotFoundException({
        code: 'PERMISSION_NOT_FOUND',
        message: `Permission '${key}' not found`,
      });
    }
    const updated = await this.rbacRepo.updatePermission(key, {
      label: label !== undefined ? label.trim() : undefined,
      group: group !== undefined ? group.trim() : undefined,
      description: description !== undefined ? description.trim() : undefined,
    });

    if (this.audit) {
      await this.audit.append({
        actorUserId: actorId,
        action: 'PERMISSION_UPDATED',
        resourceType: 'permission',
        resourceId: key,
        metadata: { label: updated?.label || perm.label },
      });
    }

    return updated!;
  }

  async deletePermission(key: string, actorId?: string): Promise<void> {
    const perm = await this.rbacRepo.findPermissionByKey(key);
    if (!perm) {
      throw new NotFoundException({
        code: 'PERMISSION_NOT_FOUND',
        message: `Permission '${key}' not found`,
      });
    }
    await this.rbacRepo.deletePermission(key);
    await this.rbacRepo.deleteRolePermissionsByPermissionKey(key);

    if (this.audit) {
      await this.audit.append({
        actorUserId: actorId,
        action: 'PERMISSION_DELETED',
        resourceType: 'permission',
        resourceId: key,
      });
    }
  }

  async getRolePermissions(roleId: string): Promise<string[]> {
    const role = await this.rbacRepo.findRoleById(roleId);
    const resolvedRoleId = role ? role.id : roleId;
    return this.rbacRepo.findRolePermissions(resolvedRoleId);
  }

  async updateRolePermissions(
    roleId: string,
    permissionKeys: string[],
    actorId?: string,
  ): Promise<string[]> {
    const role = await this.rbacRepo.findRoleById(roleId);
    if (!role) {
      throw new NotFoundException({
        code: 'ROLE_NOT_FOUND',
        message: `Role '${roleId}' not found`,
      });
    }
    const resolvedRoleId = role.id;

    const uniqueKeys = Array.from(new Set(permissionKeys));

    if (uniqueKeys.length > 0) {
      const validPerms = await this.rbacRepo.findValidPermissions(uniqueKeys);
      if (validPerms.length !== uniqueKeys.length) {
        throw new BadRequestException({
          code: 'INVALID_PERMISSIONS',
          message: 'One or more permission keys are invalid',
        });
      }
    }

    const updated = await this.rbacRepo.updateRolePermissions(resolvedRoleId, uniqueKeys);

    if (this.audit) {
      await this.audit.append({
        actorUserId: actorId,
        action: 'ROLE_PERMISSIONS_UPDATED',
        resourceType: 'role',
        resourceId: resolvedRoleId,
        metadata: {
          permissionCount: uniqueKeys.length.toString(),
          permissions: uniqueKeys.join(','),
        },
      });
    }

    return updated;
  }

  async getUserRoles(userId: string): Promise<string[]> {
    return this.rbacRepo.findUserRoles(userId);
  }

  async updateUserRoles(
    userId: string,
    roleIds: string[],
    actorId?: string,
  ): Promise<string[]> {
    const user = await this.rbacRepo.findUserById(userId);
    if (!user) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: `User '${userId}' not found`,
      });
    }

    const validRoleIds = await this.rbacRepo.findValidRoles(roleIds);
    const updated = await this.rbacRepo.updateUserRoles(userId, validRoleIds);

    if (this.audit) {
      await this.audit.append({
        actorUserId: actorId,
        action: 'USER_ROLES_UPDATED',
        resourceType: 'user',
        resourceId: userId,
        metadata: {
          roles: validRoleIds.join(','),
        },
      });
    }

    return updated;
  }

  async getAllUsers(): Promise<
    Array<{
      id: string;
      email: string;
      fullName: string;
      isPlatformAdmin: boolean;
      roles: string[];
    }>
  > {
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
