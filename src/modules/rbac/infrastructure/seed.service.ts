import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Role, RoleDocument } from './schemas/role.schema';
import { Permission, PermissionDocument } from './schemas/permission.schema';
import { RolePermission, RolePermissionDocument } from './schemas/role-permission.schema';
import { UserRole, UserRoleDocument } from './schemas/user-role.schema';
import { User, UserDocument } from '../../users/infrastructure/user.schema';
import { MenuItem, MenuItemDocument, ApplicationContext, MenuItemType, MenuItemStatus } from '../../menus/infrastructure/schemas/menu-item.schema';
import { MenuItemPermission, MenuItemPermissionDocument } from '../../menus/infrastructure/schemas/menu-item-permission.schema';

export const SYSTEM_PERMISSIONS = [
  { key: 'dashboard.view', label: 'View Dashboard', group: 'Dashboard', description: 'Access dashboard overview' },
  { key: 'projects.view', label: 'View Projects', group: 'Projects', description: 'View projects list and details' },
  { key: 'projects.create', label: 'Create Projects', group: 'Projects', description: 'Create new modernization projects' },
  { key: 'projects.update', label: 'Update Projects', group: 'Projects', description: 'Edit existing projects' },
  { key: 'projects.delete', label: 'Delete Projects', group: 'Projects', description: 'Remove projects' },
  { key: 'conversion.view', label: 'View Conversions', group: 'Conversion', description: 'View conversion jobs' },
  { key: 'conversion.execute', label: 'Execute Conversion', group: 'Conversion', description: 'Run code conversion jobs' },
  { key: 'diagnostics.view', label: 'View Diagnostics', group: 'Diagnostics', description: 'View system analysis findings' },
  { key: 'diagnostics.review', label: 'Review Diagnostics', group: 'Diagnostics', description: 'Perform diagnostic reviews' },
  { key: 'users.view', label: 'View Users', group: 'Users', description: 'View platform users' },
  { key: 'users.manage', label: 'Manage Users', group: 'Users', description: 'Create/edit users and assign roles' },
  { key: 'roles.view', label: 'View Roles', group: 'Roles', description: 'View roles and permissions' },
  { key: 'roles.manage', label: 'Manage Roles', group: 'Roles', description: 'Create/edit roles and role permissions' },
  { key: 'menu.view', label: 'View Menu Settings', group: 'Menu', description: 'View menu configurations' },
  { key: 'menu.manage', label: 'Manage Menu Builder', group: 'Menu', description: 'Configure application menus' },
  { key: 'system.settings', label: 'System Settings', group: 'System', description: 'Manage global system settings' },
];

export const BASELINE_MENU_ITEMS = [
  // WEB_2 Items (Internal Staff App)
  {
    id: 'w2-dashboard',
    key: 'dashboard',
    application: ApplicationContext.WEB_2,
    label: 'Dashboard',
    type: MenuItemType.PAGE,
    icon: 'LayoutDashboard',
    route: '/admin/dashboard',
    parentId: null,
    order: 10,
    visibility: true,
    status: MenuItemStatus.ACTIVE,
    permissions: ['dashboard.view'],
  },
  {
    id: 'w2-projects',
    key: 'projects',
    application: ApplicationContext.WEB_2,
    label: 'Projects',
    type: MenuItemType.GROUP,
    icon: 'FolderKanban',
    route: null,
    parentId: null,
    order: 20,
    visibility: true,
    status: MenuItemStatus.ACTIVE,
    permissions: ['projects.view'],
  },
  {
    id: 'w2-projects-all',
    key: 'projects.all',
    application: ApplicationContext.WEB_2,
    label: 'All Projects',
    type: MenuItemType.PAGE,
    icon: 'List',
    route: '/admin/projects',
    parentId: 'w2-projects',
    order: 1,
    visibility: true,
    status: MenuItemStatus.ACTIVE,
    permissions: ['projects.view'],
  },
  {
    id: 'w2-projects-create',
    key: 'projects.create',
    application: ApplicationContext.WEB_2,
    label: 'Create Project',
    type: MenuItemType.PAGE,
    icon: 'PlusCircle',
    route: '/admin/projects/create',
    parentId: 'w2-projects',
    order: 2,
    visibility: true,
    status: MenuItemStatus.ACTIVE,
    permissions: ['projects.create'],
  },
  {
    id: 'w2-conversion',
    key: 'conversion',
    application: ApplicationContext.WEB_2,
    label: 'Conversion Engine',
    type: MenuItemType.GROUP,
    icon: 'Cpu',
    route: null,
    parentId: null,
    order: 30,
    visibility: true,
    status: MenuItemStatus.ACTIVE,
    permissions: ['conversion.view'],
  },
  {
    id: 'w2-conversion-run',
    key: 'conversion.run',
    application: ApplicationContext.WEB_2,
    label: 'Run Conversion',
    type: MenuItemType.PAGE,
    icon: 'Play',
    route: '/admin/conversion/run',
    parentId: 'w2-conversion',
    order: 1,
    visibility: true,
    status: MenuItemStatus.ACTIVE,
    permissions: ['conversion.execute'],
  },
  {
    id: 'w2-diagnostics',
    key: 'diagnostics',
    application: ApplicationContext.WEB_2,
    label: 'System Diagnostics',
    type: MenuItemType.PAGE,
    icon: 'ShieldCheck',
    route: '/admin/diagnostics',
    parentId: null,
    order: 40,
    visibility: true,
    status: MenuItemStatus.ACTIVE,
    permissions: ['diagnostics.view'],
  },
  {
    id: 'w2-users',
    key: 'users',
    application: ApplicationContext.WEB_2,
    label: 'User Management',
    type: MenuItemType.PAGE,
    icon: 'Users',
    route: '/admin/users',
    parentId: null,
    order: 50,
    visibility: true,
    status: MenuItemStatus.ACTIVE,
    permissions: ['users.view'],
  },
  {
    id: 'w2-roles',
    key: 'roles',
    application: ApplicationContext.WEB_2,
    label: 'Roles & Permissions',
    type: MenuItemType.PAGE,
    icon: 'Shield',
    route: '/admin/roles',
    parentId: null,
    order: 60,
    visibility: true,
    status: MenuItemStatus.ACTIVE,
    permissions: ['roles.view'],
  },
  {
    id: 'w2-menu-builder',
    key: 'menu.builder',
    application: ApplicationContext.WEB_2,
    label: 'Menu Builder',
    type: MenuItemType.PAGE,
    icon: 'Workflow',
    route: '/admin/menu-builder',
    parentId: null,
    order: 70,
    visibility: true,
    status: MenuItemStatus.ACTIVE,
    permissions: ['menu.manage'],
  },
  {
    id: 'w2-settings',
    key: 'system.settings',
    application: ApplicationContext.WEB_2,
    label: 'System Settings',
    type: MenuItemType.PAGE,
    icon: 'Settings',
    route: '/admin/settings',
    parentId: null,
    order: 80,
    visibility: true,
    status: MenuItemStatus.ACTIVE,
    permissions: ['system.settings'],
  },

  // WEB_3 Items (Future Enterprise Portal)
  {
    id: 'w3-dashboard',
    key: 'w3.dashboard',
    application: ApplicationContext.WEB_3,
    label: 'Enterprise Portal Overview',
    type: MenuItemType.PAGE,
    icon: 'Building2',
    route: '/enterprise/dashboard',
    parentId: null,
    order: 10,
    visibility: true,
    status: MenuItemStatus.ACTIVE,
    permissions: ['dashboard.view'],
  },
  {
    id: 'w3-partner-profiles',
    key: 'w3.partner.profiles',
    application: ApplicationContext.WEB_3,
    label: 'Partner Profiles',
    type: MenuItemType.PAGE,
    icon: 'Briefcase',
    route: '/enterprise/partners',
    parentId: null,
    order: 20,
    visibility: true,
    status: MenuItemStatus.ACTIVE,
    permissions: ['projects.view'],
  },
];

@Injectable()
export class SeedService implements OnModuleInit {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    @InjectModel(Role.name) private readonly roleModel: Model<RoleDocument>,
    @InjectModel(Permission.name) private readonly permissionModel: Model<PermissionDocument>,
    @InjectModel(RolePermission.name) private readonly rolePermissionModel: Model<RolePermissionDocument>,
    @InjectModel(UserRole.name) private readonly userRoleModel: Model<UserRoleDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(MenuItem.name) private readonly menuItemModel: Model<MenuItemDocument>,
    @InjectModel(MenuItemPermission.name) private readonly menuItemPermissionModel: Model<MenuItemPermissionDocument>,
  ) {}

  async onModuleInit() {
    await this.seedPermissions();
    await this.seedAdminRole();
    await this.seedMenuItems();
    await this.syncPlatformAdminUsers();
  }

  private async seedPermissions() {
    for (const p of SYSTEM_PERMISSIONS) {
      await this.permissionModel.updateOne(
        { key: p.key },
        { $set: p },
        { upsert: true }
      );
    }
    this.logger.log(`Seeded ${SYSTEM_PERMISSIONS.length} system permissions.`);
  }

  private async seedAdminRole() {
    const adminRoleId = 'ADMIN';
    await this.roleModel.updateOne(
      { id: adminRoleId },
      {
        $set: {
          id: adminRoleId,
          name: 'Platform Administrator',
          description: 'Full administrative access to all internal platform functions and settings',
          isSystem: true,
        },
      },
      { upsert: true }
    );

    // Assign ALL permissions to ADMIN role
    for (const p of SYSTEM_PERMISSIONS) {
      await this.rolePermissionModel.updateOne(
        { roleId: adminRoleId, permissionKey: p.key },
        { $set: { roleId: adminRoleId, permissionKey: p.key } },
        { upsert: true }
      );
    }
    this.logger.log('Seeded system ADMIN role and linked all permissions.');
  }

  private async seedMenuItems() {
    for (const item of BASELINE_MENU_ITEMS) {
      const { permissions, ...menuItemData } = item;
      await this.menuItemModel.updateOne(
        { id: menuItemData.id },
        { $setOnInsert: menuItemData },
        { upsert: true }
      );

      for (const permKey of permissions) {
        await this.menuItemPermissionModel.updateOne(
          { menuItemId: menuItemData.id, permissionKey: permKey },
          { $setOnInsert: { menuItemId: menuItemData.id, permissionKey: permKey } },
          { upsert: true }
        );
      }
    }
    this.logger.log(`Seeded baseline menu items and permissions.`);
  }

  private async syncPlatformAdminUsers() {
    const adminUsers = await this.userModel.find({ isPlatformAdmin: true });
    for (const user of adminUsers) {
      await this.userRoleModel.updateOne(
        { userId: user.id || user._id.toString(), roleId: 'ADMIN' },
        { $set: { userId: user.id || user._id.toString(), roleId: 'ADMIN' } },
        { upsert: true }
      );
    }
  }
}
