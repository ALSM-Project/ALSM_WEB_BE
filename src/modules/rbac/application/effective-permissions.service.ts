import { Inject, Injectable } from '@nestjs/common';
import { IRbacRepository, RBAC_REPOSITORY } from '../domain/rbac.repository.interface';

@Injectable()
export class EffectivePermissionsService {
  constructor(
    @Inject(RBAC_REPOSITORY) private readonly rbacRepo: IRbacRepository,
  ) {}

  async getUserRoles(userId: string): Promise<string[]> {
    const roleIds = await this.rbacRepo.findUserRoles(userId);

    const user = await this.rbacRepo.findUserById(userId);
    if (user?.isPlatformAdmin && !roleIds.includes('ADMIN')) {
      roleIds.push('ADMIN');
    }

    return Array.from(new Set(roleIds));
  }

  async getEffectivePermissions(userId: string): Promise<string[]> {
    const user = await this.rbacRepo.findUserById(userId);
    if (user?.isPlatformAdmin) {
      const allPerms = await this.rbacRepo.findPermissions();
      return allPerms.map((p) => p.key);
    }

    const roleIds = await this.getUserRoles(userId);
    if (roleIds.length === 0) return [];

    const permissionKeys = await this.rbacRepo.findRolePermissionsByRoleIds(roleIds);
    return Array.from(new Set(permissionKeys));
  }
}
