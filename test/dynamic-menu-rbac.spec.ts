import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { MenuBuilderService } from '../src/modules/menus/application/services/menu-builder.service';
import { NavigationService } from '../src/modules/menus/application/services/navigation.service';
import { EffectivePermissionsService } from '../src/modules/rbac/application/effective-permissions.service';
import { RbacService } from '../src/modules/rbac/application/rbac.service';
import {
  IMenuBuilderRepository,
  INavigationRepository,
} from '../src/modules/menus/domain/interfaces/menu-builder.repository.interface';
import { ApplicationContext, MenuItemStatus, MenuItemType } from '../src/modules/menus/domain/enums/menu.enums';
import { IRbacRepository } from '../src/modules/rbac/domain/rbac.repository.interface';
import { AuditRepository } from '../src/modules/audit/domain/audit.repository';

describe('Dynamic Menu & RBAC Integration Tests', () => {
  describe('MenuBuilderService Integrity, Uniqueness, and Audit', () => {
    it('rejects duplicate menu key within the same application with ConflictException', async () => {
      const mockRepo: Partial<IMenuBuilderRepository> = {
        findMenuItemByKey: jest.fn().mockResolvedValue({
          id: 'item-1',
          key: 'duplicate.key',
          application: ApplicationContext.WEB_2,
          label: 'Existing Item',
          type: MenuItemType.PAGE,
          icon: 'Folder',
          route: '/existing',
          parentId: null,
          order: 1,
          visibility: true,
          status: MenuItemStatus.ACTIVE,
        }),
      };

      const service = new MenuBuilderService(mockRepo as IMenuBuilderRepository);

      await expect(
        service.createMenuItem({
          key: 'duplicate.key',
          application: ApplicationContext.WEB_2,
          label: 'New Duplicate Item',
          type: MenuItemType.PAGE,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects making a menu item a child of its own descendant (prevent cycles)', async () => {
      const mockRepo: Partial<IMenuBuilderRepository> = {
        findMenuItemById: jest.fn().mockImplementation((id: string) => {
          if (id === 'root-1') {
            return Promise.resolve({
              id: 'root-1',
              key: 'root-1',
              application: ApplicationContext.WEB_2,
              label: 'Root',
              type: MenuItemType.GROUP,
              icon: 'Folder',
              route: null,
              parentId: null,
              order: 1,
              visibility: true,
              status: MenuItemStatus.ACTIVE,
            });
          }
          if (id === 'child-1') {
            return Promise.resolve({
              id: 'child-1',
              key: 'child-1',
              application: ApplicationContext.WEB_2,
              label: 'Child',
              type: MenuItemType.PAGE,
              icon: 'Folder',
              route: '/child',
              parentId: 'root-1',
              order: 1,
              visibility: true,
              status: MenuItemStatus.ACTIVE,
            });
          }
          return Promise.resolve(null);
        }),
        getDescendantIds: jest.fn().mockResolvedValue(['child-1', 'sub-child-1']),
      };

      const service = new MenuBuilderService(mockRepo as IMenuBuilderRepository);

      await expect(
        service.updateMenuItem('root-1', { parentId: 'child-1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('records immutable audit log entry when a menu item is created and deleted', async () => {
      const mockAudit: Partial<AuditRepository> = {
        append: jest.fn().mockResolvedValue(undefined),
      };

      const mockRepo: Partial<IMenuBuilderRepository> = {
        findMenuItemByKey: jest.fn().mockResolvedValue(null),
        findMenuItemById: jest.fn().mockResolvedValue({
          id: 'item-new',
          key: 'new.item',
          application: ApplicationContext.WEB_2,
          label: 'New Item',
          type: MenuItemType.PAGE,
          icon: 'Zap',
          route: '/new',
          parentId: null,
          order: 1,
          visibility: true,
          status: MenuItemStatus.ACTIVE,
        }),
        createMenuItem: jest.fn().mockResolvedValue({
          id: 'item-new',
          key: 'new.item',
          application: ApplicationContext.WEB_2,
          label: 'New Item',
          type: MenuItemType.PAGE,
          icon: 'Zap',
          route: '/new',
          parentId: null,
          order: 1,
          visibility: true,
          status: MenuItemStatus.ACTIVE,
        }),
        countChildren: jest.fn().mockResolvedValue(0),
        deleteMenuItem: jest.fn().mockResolvedValue(undefined),
      };

      const service = new MenuBuilderService(
        mockRepo as IMenuBuilderRepository,
        mockAudit as AuditRepository,
      );

      await service.createMenuItem(
        {
          key: 'new.item',
          application: ApplicationContext.WEB_2,
          label: 'New Item',
          type: MenuItemType.PAGE,
          icon: 'Zap',
          route: '/new',
        },
        'admin-user-123',
      );

      expect(mockAudit.append).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: 'admin-user-123',
          action: 'MENU_ITEM_CREATED',
          resourceType: 'menu_item',
          resourceId: 'item-new',
        }),
      );

      await service.deleteMenuItem('item-new', 'admin-user-123');
      expect(mockAudit.append).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: 'admin-user-123',
          action: 'MENU_ITEM_DELETED',
          resourceType: 'menu_item',
          resourceId: 'item-new',
        }),
      );
    });
  });

  describe('NavigationService Dynamic Permission Filtering & Safe Fallback', () => {
    it('filters menu items based on user effective permissions and prunes empty groups', async () => {
      const mockNavRepo: Partial<INavigationRepository> = {
        findActiveVisibleMenuItems: jest.fn().mockResolvedValue([
          {
            id: 'm-dash',
            key: 'dashboard',
            application: ApplicationContext.WEB_2,
            label: 'Dashboard',
            type: MenuItemType.PAGE,
            icon: 'LayoutDashboard',
            route: '/',
            parentId: null,
            order: 1,
            visibility: true,
            status: MenuItemStatus.ACTIVE,
          },
          {
            id: 'm-group-admin',
            key: 'group.admin',
            application: ApplicationContext.WEB_2,
            label: 'Administration',
            type: MenuItemType.GROUP,
            icon: 'Settings2',
            route: null,
            parentId: null,
            order: 2,
            visibility: true,
            status: MenuItemStatus.ACTIVE,
          },
          {
            id: 'm-roles',
            key: 'admin.roles',
            application: ApplicationContext.WEB_2,
            label: 'Roles',
            type: MenuItemType.PAGE,
            icon: 'Shield',
            route: '/admin/roles',
            parentId: 'm-group-admin',
            order: 1,
            visibility: true,
            status: MenuItemStatus.ACTIVE,
          },
          {
            id: 'm-group-sales',
            key: 'group.sales',
            application: ApplicationContext.WEB_2,
            label: 'Commercial',
            type: MenuItemType.GROUP,
            icon: 'Zap',
            route: null,
            parentId: null,
            order: 3,
            visibility: true,
            status: MenuItemStatus.ACTIVE,
          },
          {
            id: 'm-quotes',
            key: 'commercial.quotes',
            application: ApplicationContext.WEB_2,
            label: 'Quotes',
            type: MenuItemType.PAGE,
            icon: 'Zap',
            route: '/admin/billing/quotes',
            parentId: 'm-group-sales',
            order: 1,
            visibility: true,
            status: MenuItemStatus.ACTIVE,
          },
        ]),
        findMenuItemPermissionsByItemIds: jest.fn().mockResolvedValue(
          new Map([
            ['m-dash', []],
            ['m-group-admin', []],
            ['m-roles', ['roles.manage']],
            ['m-group-sales', []],
            ['m-quotes', ['billing.quotes.manage']],
          ]),
        ),
      };

      const mockEffectivePerms: Partial<EffectivePermissionsService> = {
        getEffectivePermissions: jest.fn().mockResolvedValue(['billing.quotes.manage']),
      };

      const navService = new NavigationService(
        mockNavRepo as INavigationRepository,
        mockEffectivePerms as EffectivePermissionsService,
      );

      const result = await navService.getUserNavigation('sales-user-1', ApplicationContext.WEB_2);

      // Should include Dashboard
      expect(result.some((r) => r.id === 'm-dash')).toBe(true);

      // Should include Commercial group because quotes is permitted
      const salesGroup = result.find((r) => r.id === 'm-group-sales');
      expect(salesGroup).toBeDefined();
      expect(salesGroup?.children?.some((c) => c.id === 'm-quotes')).toBe(true);

      // Administration group should be PRUNED because m-roles is not permitted
      const adminGroup = result.find((r) => r.id === 'm-group-admin');
      expect(adminGroup).toBeUndefined();
    });

    it('returns safe default Dashboard menu item when user has zero permitted items (SRS rule)', async () => {
      const mockNavRepo: Partial<INavigationRepository> = {
        findActiveVisibleMenuItems: jest.fn().mockResolvedValue([
          {
            id: 'm-restricted',
            key: 'admin.only',
            application: ApplicationContext.WEB_2,
            label: 'Secret',
            type: MenuItemType.PAGE,
            icon: 'Lock',
            route: '/secret',
            parentId: null,
            order: 1,
            visibility: true,
            status: MenuItemStatus.ACTIVE,
          },
        ]),
        findMenuItemPermissionsByItemIds: jest.fn().mockResolvedValue(
          new Map([['m-restricted', ['top.secret']]]),
        ),
      };

      const mockEffectivePerms: Partial<EffectivePermissionsService> = {
        getEffectivePermissions: jest.fn().mockResolvedValue([]),
      };

      const navService = new NavigationService(
        mockNavRepo as INavigationRepository,
        mockEffectivePerms as EffectivePermissionsService,
      );

      const result = await navService.getUserNavigation('unprivileged-user', ApplicationContext.WEB_2);

      // Must return safe default Dashboard, never empty or restricted items
      expect(result.length).toBe(1);
      expect(result[0].key).toBe('dashboard');
      expect(result[0].route).toBe('/');
      expect(result[0].requiredPermissions).toEqual([]);
    });
  });

  describe('RBAC Roles, System Roles, and Permission Invalidation', () => {
    it('prevents deletion of system roles with ForbiddenException', async () => {
      const mockRbacRepo: Partial<IRbacRepository> = {
        findRoleById: jest.fn().mockResolvedValue({
          id: 'team_lead',
          name: 'Team Lead',
          description: '',
          isSystem: true,
        }),
      };

      const rbacService = new RbacService(mockRbacRepo as IRbacRepository);

      await expect(rbacService.deleteRole('team_lead')).rejects.toThrow(ForbiddenException);
    });

    it('prevents deletion of custom roles assigned to active users with ConflictException', async () => {
      const mockRbacRepo: Partial<IRbacRepository> = {
        findRoleById: jest.fn().mockResolvedValue({
          id: 'CUSTOM_REVIEWER',
          name: 'Custom Reviewer',
          description: '',
          isSystem: false,
        }),
        countUsersWithRole: jest.fn().mockResolvedValue(3),
      };

      const rbacService = new RbacService(mockRbacRepo as IRbacRepository);

      await expect(rbacService.deleteRole('CUSTOM_REVIEWER')).rejects.toThrow(ConflictException);
    });

    it('propagates role permission update immediately to effective permissions without token re-issue', async () => {
      let rolePermissions = ['meetings.view'];

      const mockRbacRepo: Partial<IRbacRepository> = {
        findRoleById: jest.fn().mockResolvedValue({
          id: 'CUSTOM_ROLE',
          name: 'Custom Role',
          description: '',
          isSystem: false,
        }),
        findUserRoles: jest.fn().mockResolvedValue(['CUSTOM_ROLE']),
        findUserById: jest.fn().mockResolvedValue({
          id: 'user-42',
          isPlatformAdmin: false,
        }),
        findValidPermissions: jest.fn().mockResolvedValue(['meetings.view', 'meetings.create']),
        updateRolePermissions: jest.fn().mockImplementation((roleId, keys) => {
          rolePermissions = keys;
          return Promise.resolve(keys);
        }),
        findRolePermissionsByRoleIds: jest.fn().mockImplementation(() => Promise.resolve(rolePermissions)),
      };

      const rbacService = new RbacService(mockRbacRepo as IRbacRepository);
      const effectivePermsService = new EffectivePermissionsService(mockRbacRepo as IRbacRepository);

      // Before update
      const initialPerms = await effectivePermsService.getEffectivePermissions('user-42');
      expect(initialPerms).toEqual(['meetings.view']);

      // Admin updates role permissions
      await rbacService.updateRolePermissions('CUSTOM_ROLE', ['meetings.view', 'meetings.create']);

      // Immediate resolution shows updated permissions
      const updatedPerms = await effectivePermsService.getEffectivePermissions('user-42');
      expect(updatedPerms).toEqual(['meetings.view', 'meetings.create']);
    });
  });
});
