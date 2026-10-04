import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { RbacService } from './rbac.service';

// Seed the TEAM_LEAD role and the user-onboarding permissions so UC-82
// (User Onboarding) works out of the box. Idempotent: role/permission
// creation is skipped when it already exists.
@Injectable()
export class RbacSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RbacSeedService.name);

  constructor(private readonly rbacService: RbacService) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.ensureRole(
      'TEAM_LEAD',
      'Team Lead',
      'Can onboard and manage internal staff accounts',
    );
    await this.ensurePermission(
      'users.onboard',
      'Onboard users',
      'users',
      'Create internal staff accounts',
    );
    await this.ensurePermission(
      'users.manage',
      'Manage users',
      'users',
      'Activate, deactivate and list users',
    );
    await this.grantRolePermissions('TEAM_LEAD', ['users.onboard', 'users.manage']);
  }

  private async ensureRole(id: string, name: string, description: string): Promise<void> {
    const existing = await this.rbacService.getRoleById(id).catch(() => null);
    if (!existing) {
      await this.rbacService.createRole(id, name, description);
      this.logger.log(`Seeded role ${id}`);
    }
  }

  private async ensurePermission(
    key: string,
    label: string,
    group: string,
    description: string,
  ): Promise<void> {
    const perms = await this.rbacService.getPermissions();
    if (!perms.some((p) => p.key === key)) {
      await this.rbacService.createPermission(key, label, group, description);
      this.logger.log(`Seeded permission ${key}`);
    }
  }

  private async grantRolePermissions(roleId: string, permissionKeys: string[]): Promise<void> {
    const current = await this.rbacService.getRolePermissions(roleId);
    const missing = permissionKeys.filter((k) => !current.includes(k));
    if (missing.length > 0) {
      await this.rbacService.updateRolePermissions(roleId, [...current, ...missing]);
    }
  }
}
