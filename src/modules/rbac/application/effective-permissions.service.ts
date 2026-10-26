import { Inject, Injectable, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { IRbacRepository, RBAC_REPOSITORY } from '../domain/rbac.repository.interface';
import { TemporaryRole, TemporaryRoleDocument } from '../infrastructure/schemas/temporary-role.schema';
import { toValidObjectId } from '../../../shared/utils/object-id.util';

@Injectable()
export class EffectivePermissionsService {
  constructor(
    @Inject(RBAC_REPOSITORY) private readonly rbacRepo: IRbacRepository,
    @Optional()
    @InjectModel(TemporaryRole.name)
    private readonly tempRoleModel?: Model<TemporaryRoleDocument>,
  ) {}

  async getUserRoles(userId: string): Promise<string[]> {
    const roleIds = await this.rbacRepo.findUserRoles(userId);

    const user = await this.rbacRepo.findUserById(userId);
    if (user?.isPlatformAdmin && !roleIds.includes('ADMIN')) {
      roleIds.push('ADMIN');
    }

    if (this.tempRoleModel) {
      try {
        const userObjId = toValidObjectId(userId);
        const activeTempRoles = await this.tempRoleModel
          .find({
            userId: userObjId,
            status: 'ACTIVE',
            expiresAt: { $gt: new Date() },
          })
          .exec();

        for (const tr of activeTempRoles) {
          if (tr.roleId && !roleIds.includes(tr.roleId)) {
            roleIds.push(tr.roleId);
          }
        }
      } catch {
        // Fallback gracefully if temp role model is uninitialized
      }
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
