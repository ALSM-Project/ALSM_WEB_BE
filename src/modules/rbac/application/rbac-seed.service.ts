import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { RbacService } from './rbac.service';
import { User, UserDocument } from '../../users/infrastructure/user.schema';
import { Role, RoleDocument } from '../infrastructure/schemas/role.schema';

@Injectable()
export class RbacSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RbacSeedService.name);

  constructor(
    private readonly rbacService: RbacService,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Role.name) private readonly roleModel: Model<RoleDocument>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // 1. System Roles
    await this.ensureRole('SYSTEM_ADMIN', 'Platform Admin', 'Platform administrator with unrestricted access', true);
    await this.ensureRole('ADMIN', 'Platform Administrator', 'Platform administrator with unrestricted access', true);
    await this.ensureRole('TEAM_LEAD', 'Team Lead', 'Internal team lead managing staff, conversions, and operations', true);
    await this.ensureRole('SALES_MANAGER', 'Sales Manager', 'Sales manager managing leads, quotes, and commercial metrics', true);
    await this.ensureRole('INTERNAL_SALES', 'Internal Sales', 'Internal sales representative managing quotes and client leads', true);
    await this.ensureRole('INTERNAL_SUPPORT', 'Internal Support', 'Customer and operational support staff', true);
    await this.ensureRole('CONVERSION_STAFF', 'Conversion Staff', 'Modernization and conversion execution staff', true);
    await this.ensureRole('SALES_REP', 'Sales Representative', 'Sales executive legacy alias', true);
    await this.ensureRole('ENTERPRISE_MEMBER', 'Enterprise Member', 'Enterprise client member', true);
    await this.ensureRole('PARTNER', 'Partner User', 'External partner organization representative with read-only modernization access', true);

    // 2. Authoritative Permission Catalog
    // Users & Access
    await this.ensurePermission('users.onboard', 'Onboard users', 'users', 'Create internal staff accounts');
    await this.ensurePermission('users.manage', 'Manage users', 'users', 'Activate, deactivate and manage users');
    await this.ensurePermission('users.view', 'View users', 'users', 'View user accounts');
    // Roles & RBAC
    await this.ensurePermission('roles.manage', 'Manage Roles', 'rbac', 'Manage roles and permissions');
    await this.ensurePermission('roles.view', 'View Roles', 'rbac', 'View roles and permissions');
    // Navigation & Menus
    await this.ensurePermission('menu.manage', 'Manage Menu', 'menus', 'Manage dynamic navigation menus');
    await this.ensurePermission('menu.view', 'View Menu', 'menus', 'View menu builder configuration');
    // Operations & Meetings
    await this.ensurePermission('meetings.create', 'Create meeting rooms', 'meetings', 'Create online meeting rooms');
    await this.ensurePermission('meetings.view', 'View meeting rooms', 'meetings', 'View online meeting rooms');
    // Commercial & Billing
    await this.ensurePermission('billing.quotes.manage', 'Manage Enterprise Quotes', 'billing', 'Approve or update enterprise quote requests');
    await this.ensurePermission('billing.usage.view', 'View Usage', 'billing', 'View organization usage stats and quotas');
    // Conversions
    await this.ensurePermission('conversions.view', 'View Conversions', 'conversions', 'View conversion projects and queue');
    await this.ensurePermission('conversions.queue.view', 'View Conversion Queue', 'conversions', 'View queue and conversion job items');
    await this.ensurePermission('conversions.execute', 'Execute Conversions', 'conversions', 'Retry or execute conversion jobs');
    await this.ensurePermission('quality-review.manage', 'Manage Quality Review', 'conversions', 'Review AI conversion findings and quality assessments');
    // Teams & CRM
    await this.ensurePermission('teams.manage', 'Manage Teams', 'teams', 'View and manage team workload and performance');
    await this.ensurePermission('sales.leads.view', 'View Sales Leads', 'sales', 'View sourced commercial leads');
    await this.ensurePermission('sales.leads.manage', 'Manage Sales Leads', 'sales', 'Create and reassign commercial sales leads');
    // Technical & Support (Section 3.10)
    await this.ensurePermission('conversions.retry', 'Retry failed conversion jobs', 'conversions', 'Retry dead conversion jobs');
    await this.ensurePermission('projects.demo.view', 'View Demo Projects', 'projects', 'View demo projects and sample workspaces');
    await this.ensurePermission('projects.demo.create', 'Create Demo Project', 'projects', 'Create sample demo projects');
    await this.ensurePermission('organizations.impersonate', 'Impersonate Organisation', 'support', 'Read-only access to customer organisations');
    await this.ensurePermission('conversions.troubleshoot.view', 'View Conversion Support', 'support', 'View conversion failure details and open troubleshooting workspace');
    await this.ensurePermission('conversions.mapping.validate', 'Validate Proposed Mapping', 'support', 'Run simulated validation on source-to-target field mappings');
    await this.ensurePermission('conversions.support_patch.apply', 'Apply Support Patch', 'support', 'Apply override mapping patch to unresolved conversion items');
    // CRM & Sales Reporting (Section 3.11 & 3.12)
    await this.ensurePermission('sales.reports.view', 'View Sales Reports', 'sales', 'View comprehensive sales analytics and pipeline metrics');
    await this.ensurePermission('sales.team-performance.view', 'View Team Performance', 'sales', 'View sales team metrics and representative rankings');
    await this.ensurePermission('sales.discounts.view', 'View Discount Approval Queue', 'sales', 'View discount approval requests queue');
    await this.ensurePermission('sales.discounts.approve', 'Approve Discount Requests', 'sales', 'Authorize and approve requested sales discounts');
    await this.ensurePermission('sales.discounts.reject', 'Reject Discount Requests', 'sales', 'Reject sales representative discount requests with mandatory justification');
    // Platform Administration (Section 3.13)
    await this.ensurePermission('organizations.view', 'View Organisations', 'admin', 'View customer and enterprise organisations');
    await this.ensurePermission('organizations.manage', 'Manage Organisations', 'admin', 'Create enterprise organisations and manage engagements');
    await this.ensurePermission('revenue.view', 'View Total Revenue', 'finance', 'View platform-wide revenue and contract metrics');
    await this.ensurePermission('engagement-types.manage', 'Manage Engagement Types', 'admin', 'Create and edit engagement types');
    await this.ensurePermission('users.lock', 'Lock User Account', 'admin', 'Lock or unlock user accounts');
    await this.ensurePermission('audit.view', 'View Audit Logs', 'admin', 'View and export immutable system audit logs');
    // User Lifecycle & Resource Management (Section 3.14)
    await this.ensurePermission('users.offboard', 'Offboard Users', 'admin', 'Initiate controlled user offboarding workflows');
    await this.ensurePermission('users.offboard.review', 'Review Departing Staff Resources', 'admin', 'Review work resources, queue jobs, and security credentials assigned to departing staff');
    await this.ensurePermission('resources.assignment.view', 'View Resource Assignments', 'admin', 'View resource ownership, team lead allocations, and staff assignments');
    await this.ensurePermission('resources.transfer', 'Transfer Resource Ownership', 'admin', 'Transfer or reassign resource ownership between staff');
    await this.ensurePermission('resources.transfer.confirm', 'Confirm Resource Transfers', 'admin', 'Explicitly confirm and execute resource ownership transfer to successor staff');
    // Temporary Role Management (Section 3.15)
    await this.ensurePermission('roles.temporary.view', 'View Temporary Roles', 'rbac', 'View currently active temporary role elevations and time remaining');
    await this.ensurePermission('roles.temporary.grant', 'Grant Temporary Role', 'rbac', 'Authorize and grant time-bound temporary role elevations (strictly max 24h)');
    await this.ensurePermission('roles.temporary.revoke', 'Revoke Temporary Role', 'rbac', 'Immediately terminate active temporary role elevations');
    await this.ensurePermission('roles.temporary.history.view', 'View Temporary Role History', 'rbac', 'View historical elevation audit trail, termination reasons, and export reports');
    await this.ensurePermission('roles.temporary.request', 'Request Temporary Role', 'rbac', 'Submit request for self-service temporary role elevation');
    await this.ensurePermission('roles.temporary.requests.review', 'Review Temporary Role Requests', 'rbac', 'Inspect and review incoming temporary elevation requests from team members');
    await this.ensurePermission('roles.temporary.requests.approve', 'Approve Temporary Role Requests', 'rbac', 'Authorize and approve incoming temporary elevation requests with specified duration');
    await this.ensurePermission('roles.temporary.requests.reject', 'Reject Temporary Role Requests', 'rbac', 'Reject temporary elevation requests with mandatory justification');
    await this.ensurePermission('roles.temporary.manage', 'Manage Temporary Roles', 'rbac', 'Administrative oversight for temporary role elevations');
    // Diagnostics & System
    await this.ensurePermission('diagnostics.view', 'View Diagnostics', 'system', 'View system diagnostics and health');

    // Section 3.A: Partner Management — Internal Staff
    await this.ensurePermission('partner.view', 'View Partners', 'partners', 'View the Partner list and Partner details');
    await this.ensurePermission('partner.create', 'Create Partner', 'partners', 'Create a new Partner profile');
    await this.ensurePermission('partner.update', 'Update Partner', 'partners', 'Edit an existing Partner profile');
    await this.ensurePermission('partner.manage_status', 'Manage Partner Status', 'partners', 'Activate or deactivate a Partner');

    // Section 3.B: Partner Project Management — Internal Staff
    await this.ensurePermission('partner_project.view', 'View Partner Projects', 'partner_projects', 'View Partner projects and project details');
    await this.ensurePermission('partner_project.create', 'Create Partner Project', 'partner_projects', 'Create a new Partner project');
    await this.ensurePermission('partner_project.update', 'Update Partner Project', 'partner_projects', 'Edit project metadata');
    await this.ensurePermission('partner_project.manage_files', 'Manage Partner Project Files', 'partner_projects', 'Upload, remove, or manage source files');
    await this.ensurePermission('partner_project.start_conversion', 'Start Partner Conversion', 'partner_projects', 'Start a conversion job for a partner project');
    await this.ensurePermission('partner_project.view_progress', 'View Partner Project Progress', 'partner_projects', 'View conversion progress and status');

    // Section 3.C: Conversion Review — Internal Staff
    await this.ensurePermission('conversion_result.view', 'View Conversion Results', 'conversions', 'View conversion results and generated artifacts');
    await this.ensurePermission('conversion_result.review', 'Review Conversion Results', 'conversions', 'Open and review conversion results');
    await this.ensurePermission('conversion_result.manage_findings', 'Manage Findings', 'conversions', 'Review findings and update their status (Confirm, Reject, N/A)');
    await this.ensurePermission('conversion_result.manage_mappings', 'Manage Field Mappings', 'conversions', 'Edit source-to-target conversion field mappings');
    await this.ensurePermission('conversion_result.view_generated_code', 'View Generated Code', 'conversions', 'View generated code and converted screen previews');
    await this.ensurePermission('conversion_result.export', 'Export Conversion Results', 'conversions', 'Export eligible conversion results into production bundles');
    await this.ensurePermission('conversion_result.notify_partner', 'Notify Partner', 'conversions', 'Notify the Partner about an export or completed result');

    // Section 3.D: Partner Portal — Read-Only Access
    await this.ensurePermission('partner_portal.dashboard.view', 'View Partner Dashboard', 'partner_portal', 'View the Partner dashboard');
    await this.ensurePermission('partner_portal.project.view', 'View Partner Projects (Portal)', 'partner_portal', "View the Partner's own projects");
    await this.ensurePermission('partner_portal.progress.view', 'View Partner Progress (Portal)', 'partner_portal', "View conversion progress and status for the Partner's own projects");
    await this.ensurePermission('partner_portal.result.view', 'View Conversion Results (Portal)', 'partner_portal', 'View completed conversion results belonging to the Partner');
    await this.ensurePermission('partner_portal.error.view', 'View Error Details (Portal)', 'partner_portal', 'View safe, user-facing conversion error details');
    await this.ensurePermission('partner_portal.download', 'Download Bundles (Portal)', 'partner_portal', 'Download authorized exported bundles');

    // 3. Grant Permissions to System Roles
    const allCatalogPermissionKeys = [
      'users.onboard',
      'users.manage',
      'users.view',
      'users.lock',
      'users.offboard',
      'users.offboard.review',
      'resources.assignment.view',
      'resources.transfer',
      'resources.transfer.confirm',
      'roles.manage',
      'roles.view',
      'roles.temporary.view',
      'roles.temporary.grant',
      'roles.temporary.revoke',
      'roles.temporary.history.view',
      'roles.temporary.request',
      'roles.temporary.requests.review',
      'roles.temporary.requests.approve',
      'roles.temporary.requests.reject',
      'roles.temporary.manage',
      'menu.manage',
      'menu.view',
      'meetings.create',
      'meetings.view',
      'billing.quotes.manage',
      'billing.usage.view',
      'conversions.view',
      'conversions.queue.view',
      'conversions.execute',
      'conversions.retry',
      'quality-review.manage',
      'teams.manage',
      'sales.leads.view',
      'sales.leads.manage',
      'sales.reports.view',
      'sales.team-performance.view',
      'sales.discounts.view',
      'sales.discounts.approve',
      'sales.discounts.reject',
      'projects.demo.view',
      'projects.demo.create',
      'organizations.impersonate',
      'organizations.view',
      'organizations.manage',
      'conversions.troubleshoot.view',
      'conversions.mapping.validate',
      'conversions.support_patch.apply',
      'revenue.view',
      'engagement-types.manage',
      'audit.view',
      'diagnostics.view',
      'partner.view',
      'partner.create',
      'partner.update',
      'partner.manage_status',
      'partner_project.view',
      'partner_project.create',
      'partner_project.update',
      'partner_project.manage_files',
      'partner_project.start_conversion',
      'partner_project.view_progress',
      'conversion_result.view',
      'conversion_result.review',
      'conversion_result.manage_findings',
      'conversion_result.manage_mappings',
      'conversion_result.view_generated_code',
      'conversion_result.export',
      'conversion_result.notify_partner',
      'partner_portal.dashboard.view',
      'partner_portal.project.view',
      'partner_portal.progress.view',
      'partner_portal.result.view',
      'partner_portal.error.view',
      'partner_portal.download',
    ];

    await this.grantRolePermissions('SYSTEM_ADMIN', allCatalogPermissionKeys);
    await this.grantRolePermissions('ADMIN', allCatalogPermissionKeys);

    await this.grantRolePermissions('TEAM_LEAD', [
      'users.onboard',
      'users.manage',
      'users.view',
      'users.offboard',
      'users.offboard.review',
      'resources.assignment.view',
      'resources.transfer',
      'resources.transfer.confirm',
      'roles.temporary.view',
      'roles.temporary.grant',
      'roles.temporary.revoke',
      'roles.temporary.history.view',
      'roles.temporary.request',
      'roles.temporary.requests.review',
      'roles.temporary.requests.approve',
      'roles.temporary.requests.reject',
      'roles.temporary.manage',
      'meetings.create',
      'meetings.view',
      'quality-review.manage',
      'teams.manage',
      'conversions.view',
      'conversions.queue.view',
      'conversions.retry',
      'conversions.execute',
      'conversions.troubleshoot.view',
      'conversions.mapping.validate',
      'conversions.support_patch.apply',
      'projects.demo.view',
      'projects.demo.create',
      'sales.leads.view',
      'partner.view',
      'partner.create',
      'partner.update',
      'partner.manage_status',
      'partner_project.view',
      'partner_project.create',
      'partner_project.update',
      'partner_project.manage_files',
      'partner_project.start_conversion',
      'partner_project.view_progress',
      'conversion_result.view',
      'conversion_result.review',
      'conversion_result.manage_findings',
      'conversion_result.manage_mappings',
      'conversion_result.view_generated_code',
      'conversion_result.export',
      'conversion_result.notify_partner',
    ]);

    await this.grantRolePermissions('SALES_MANAGER', [
      'billing.quotes.manage',
      'billing.usage.view',
      'sales.leads.view',
      'sales.leads.manage',
      'sales.reports.view',
      'sales.team-performance.view',
      'sales.discounts.view',
      'sales.discounts.approve',
      'sales.discounts.reject',
      'meetings.create',
      'meetings.view',
      'partner.view',
      'partner_project.view',
    ]);

    await this.grantRolePermissions('INTERNAL_SALES', [
      'billing.quotes.manage',
      'billing.usage.view',
      'sales.leads.view',
      'sales.leads.manage',
      'sales.discounts.view',
      'roles.temporary.request',
      'roles.temporary.view',
      'meetings.create',
      'meetings.view',
      'partner.view',
      'partner_project.view',
    ]);

    await this.grantRolePermissions('INTERNAL_SUPPORT', [
      'meetings.create',
      'meetings.view',
      'organizations.view',
      'organizations.impersonate',
      'conversions.view',
      'conversions.queue.view',
      'conversions.troubleshoot.view',
      'conversions.mapping.validate',
      'conversions.support_patch.apply',
      'conversions.retry',
      'projects.demo.view',
      'projects.demo.create',
      'roles.temporary.request',
      'roles.temporary.view',
      'billing.usage.view',
      'diagnostics.view',
      'partner.view',
      'partner_project.view',
      'partner_project.view_progress',
      'conversion_result.view',
    ]);

    await this.grantRolePermissions('CONVERSION_STAFF', [
      'conversions.view',
      'conversions.queue.view',
      'conversions.execute',
      'conversions.retry',
      'conversions.troubleshoot.view',
      'conversions.mapping.validate',
      'projects.demo.view',
      'projects.demo.create',
      'quality-review.manage',
      'roles.temporary.request',
      'roles.temporary.view',
      'meetings.view',
      'partner.view',
      'partner.create',
      'partner_project.view',
      'partner_project.manage_files',
      'partner_project.start_conversion',
      'partner_project.view_progress',
      'conversion_result.view',
      'conversion_result.review',
      'conversion_result.manage_findings',
      'conversion_result.manage_mappings',
      'conversion_result.view_generated_code',
      'conversion_result.export',
      'conversion_result.notify_partner',
    ]);

    await this.grantRolePermissions('SALES_REP', [
      'billing.quotes.manage',
      'billing.usage.view',
      'sales.discounts.view',
      'meetings.create',
      'meetings.view',
    ]);

    await this.grantRolePermissions('ENTERPRISE_MEMBER', [
      'meetings.create',
      'meetings.view',
      'billing.usage.view',
      'partner_portal.dashboard.view',
      'partner_portal.project.view',
      'partner_portal.progress.view',
      'partner_portal.result.view',
      'partner_portal.error.view',
      'partner_portal.download',
    ]);

    await this.grantRolePermissions('PARTNER', [
      'partner.view',
      'partner_project.view',
      'projects.demo.view',
      'meetings.view',
      'partner_portal.dashboard.view',
      'partner_portal.project.view',
      'partner_portal.progress.view',
      'partner_portal.result.view',
      'partner_portal.error.view',
      'partner_portal.download',
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
      roleId: 'SALES_MANAGER',
    });

    await this.ensureTestAccount({
      email: 'sales_staff@alsm.io',
      fullName: 'Internal Sales Staff',
      isPlatformAdmin: false,
      roleId: 'INTERNAL_SALES',
    });

    await this.ensureTestAccount({
      email: 'support@alsm.io',
      fullName: 'Internal Support Staff',
      isPlatformAdmin: false,
      roleId: 'INTERNAL_SUPPORT',
    });

    await this.ensureTestAccount({
      email: 'converter@alsm.io',
      fullName: 'Conversion Specialist',
      isPlatformAdmin: false,
      roleId: 'CONVERSION_STAFF',
    });

    await this.ensureTestAccount({
      email: 'enterprise@company.com',
      fullName: 'Enterprise Client Member',
      isPlatformAdmin: false,
      roleId: 'ENTERPRISE_MEMBER',
    });

    await this.ensureTestAccount({
      email: 'partner@fintechnexus.io',
      fullName: 'Marcus Vance (Partner Lead)',
      isPlatformAdmin: false,
      roleId: 'PARTNER',
    });
  }

  private async ensureRole(
    id: string,
    name: string,
    description: string,
    isSystem: boolean = true,
  ): Promise<void> {
    const normalizedKey = id.trim().toUpperCase().replace(/\s+/g, '_');
    const existing = await this.roleModel.findOne({
      $or: [{ id }, { id: normalizedKey }],
    }).exec();

    if (!existing) {
      await this.rbacService.createRole(normalizedKey, name, description, isSystem);
      this.logger.log(`Seeded role ${normalizedKey}`);
    } else if (isSystem && !existing.isSystem) {
      // Ensure system role flag is enforced in database
      await this.roleModel.updateOne({ _id: existing._id }, { $set: { isSystem: true } }).exec();
    }
  }

  private async ensurePermission(
    key: string,
    label: string,
    group: string,
    description: string,
  ): Promise<void> {
    const normalizedKey = key.trim().toLowerCase().replace(/\s+/g, '.');
    const existing = await this.rbacService.getPermissions();
    if (!existing.some((p) => p.key === normalizedKey || p.key === key)) {
      await this.rbacService.createPermission(normalizedKey, label, group, description);
      this.logger.log(`Seeded permission ${normalizedKey}`);
    } else {
      await this.rbacService.updatePermission(normalizedKey, label, group, description);
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

    const userRoles = await this.rbacService.getUserRoles(user.id);
    if (!userRoles.includes(input.roleId)) {
      await this.rbacService.updateUserRoles(user.id, [...userRoles, input.roleId]);
    }
  }
}
