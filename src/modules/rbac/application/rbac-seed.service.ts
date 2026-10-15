import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { RbacService } from './rbac.service';
import { User, UserDocument } from '../../users/infrastructure/user.schema';

@Injectable()
export class RbacSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RbacSeedService.name);

  constructor(
    private readonly rbacService: RbacService,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // 1. Roles
    await this.ensureRole('SYSTEM_ADMIN', 'System Admin', 'Platform administrator with unrestricted access');
    await this.ensureRole('TEAM_LEAD', 'Team Lead', 'Internal team lead managing staff and meetings');
    await this.ensureRole('SALES_REP', 'Sales Representative', 'Sales manager handling Enterprise quote approvals');
    await this.ensureRole('ENTERPRISE_MEMBER', 'Enterprise Member', 'Enterprise client member using migration and meeting rooms');

    // 2. Permissions
    await this.ensurePermission('users.onboard', 'Onboard users', 'users', 'Create internal staff accounts');
    await this.ensurePermission('users.manage', 'Manage users', 'users', 'Activate, deactivate and list users');
    await this.ensurePermission('meetings.create', 'Create meeting rooms', 'meetings', 'Create online meeting rooms');
    await this.ensurePermission('meetings.view', 'View meeting rooms', 'meetings', 'View online meeting rooms');
    await this.ensurePermission('billing.quotes.manage', 'Manage Enterprise Quotes', 'billing', 'Approve or update enterprise quote requests');
    await this.ensurePermission('billing.usage.view', 'View Usage', 'billing', 'View organization usage stats');
    await this.ensurePermission('quality-review.manage', 'Manage Quality Review', 'conversions', 'Review AI conversion findings');
    await this.ensurePermission('roles.manage', 'Manage Roles', 'rbac', 'Manage roles and permissions');
    await this.ensurePermission('menu.manage', 'Manage Menu', 'menus', 'Manage navigation menus');

    // 3. Grant Permissions to Roles
    await this.grantRolePermissions('TEAM_LEAD', [
      'users.onboard',
      'users.manage',
      'meetings.create',
      'meetings.view',
      'quality-review.manage',
    ]);
    await this.grantRolePermissions('SALES_REP', [
      'billing.quotes.manage',
      'billing.usage.view',
      'meetings.create',
      'meetings.view',
    ]);
    await this.grantRolePermissions('ENTERPRISE_MEMBER', [
      'meetings.create',
      'meetings.view',
      'billing.usage.view',
    ]);

    // 4. Seed Test Accounts
    await this.ensureTestAccount({
      email: 'admin@alsm.io',
      fullName: 'System Administrator',
      isPlatformAdmin: true,
      roleId: 'SYSTEM_ADMIN',
    });

    await this.ensureTestAccount({
      email: 'teamlead@alsm.io',
      fullName: 'Team Lead Staff',
      isPlatformAdmin: false,
      roleId: 'TEAM_LEAD',
    });

    await this.ensureTestAccount({
      email: 'sales@alsm.io',
      fullName: 'Sales Executive Manager',
      isPlatformAdmin: false,
      roleId: 'SALES_REP',
    });

    await this.ensureTestAccount({
      email: 'enterprise@company.com',
      fullName: 'Enterprise Client Member',
      isPlatformAdmin: false,
      roleId: 'ENTERPRISE_MEMBER',
    });
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

  private async ensureTestAccount(input: {
    email: string;
    fullName: string;
    isPlatformAdmin: boolean;
    roleId: string;
  }): Promise<void> {
    let user = await this.userModel.findOne({ email: input.email }).exec();
    const defaultPasswordHash = await bcrypt.hash('Password123!', 10);

    if (!user) {
      user = await this.userModel.create({
        email: input.email,
        fullName: input.fullName,
        passwordHash: defaultPasswordHash,
        isPlatformAdmin: input.isPlatformAdmin,
        isActive: true,
        isEmailVerified: true,
        mustChangePassword: false,
      });
      this.logger.log(`Seeded test user account: ${input.email}`);
    } else {
      // Ensure active, email verified, and correct admin status
      await this.userModel.updateOne(
        { _id: user._id },
        {
          $set: {
            isActive: true,
            isEmailVerified: true,
            isPlatformAdmin: input.isPlatformAdmin,
            passwordHash: defaultPasswordHash,
          },
        },
      );
    }

    // Assign RBAC Role
    const userRoles = await this.rbacService.getUserRoles(user.id);
    if (!userRoles.includes(input.roleId)) {
      await this.rbacService.updateUserRoles(user.id, [...userRoles, input.roleId]);
    }
  }
}

