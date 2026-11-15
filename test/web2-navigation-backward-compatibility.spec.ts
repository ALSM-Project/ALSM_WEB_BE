import { ApplicationContext } from '../src/modules/menus/domain/enums/menu.enums';
import { NavigationService, NavNode } from '../src/modules/menus/application/services/navigation.service';
import {
  INavigationRepository,
  IMenuItemData,
} from '../src/modules/menus/domain/interfaces/menu-builder.repository.interface';
import { EffectivePermissionsService } from '../src/modules/rbac/application/effective-permissions.service';
import { Logger } from '@nestjs/common';

describe('WEB_2 Navigation Backward Compatibility & Warning Suppression Test', () => {
  let navigationService: NavigationService;
  let mockNavRepo: jest.Mocked<INavigationRepository>;
  let mockEffectivePerms: jest.Mocked<EffectivePermissionsService>;
  let loggerWarnSpy: jest.SpyInstance;
  let computeCapabilitiesSpy: jest.SpyInstance;

  const web2MenuItems: IMenuItemData[] = [
    {
      id: 'web2_group_dashboard',
      key: 'web2.group.dashboard',
      application: ApplicationContext.WEB_2,
      label: 'Dashboard Group',
      type: 'GROUP' as any,
      icon: 'LayoutDashboard',
      route: null,
      parentId: null,
      order: 1,
      visibility: true,
      status: 'ACTIVE' as any,
      contractTypeVisibility: 'ALL',
      // Notice: NO capability assigned (standard WEB_2 item)
    },
    {
      id: 'web2_dashboard',
      key: 'web2.dashboard',
      application: ApplicationContext.WEB_2,
      label: 'Dashboard',
      type: 'PAGE' as any,
      icon: 'LayoutDashboard',
      route: '/',
      parentId: 'web2_group_dashboard',
      order: 1,
      visibility: true,
      status: 'ACTIVE' as any,
      contractTypeVisibility: 'ALL',
    },
    {
      id: 'web2_group_admin',
      key: 'web2.group.admin',
      application: ApplicationContext.WEB_2,
      label: 'Administration',
      type: 'GROUP' as any,
      icon: 'Settings',
      route: null,
      parentId: null,
      order: 2,
      visibility: true,
      status: 'ACTIVE' as any,
      contractTypeVisibility: 'ALL',
    },
    {
      id: 'web2_admin_roles',
      key: 'web2.admin.roles',
      application: ApplicationContext.WEB_2,
      label: 'Roles & Permissions',
      type: 'PAGE' as any,
      icon: 'Shield',
      route: '/admin/roles',
      parentId: 'web2_group_admin',
      order: 2,
      visibility: true,
      status: 'ACTIVE' as any,
      contractTypeVisibility: 'ALL',
    },
    {
      id: 'web2_admin_users',
      key: 'web2.admin.users',
      application: ApplicationContext.WEB_2,
      label: 'User Accounts',
      type: 'PAGE' as any,
      icon: 'Users',
      route: '/admin/users',
      parentId: 'web2_group_admin',
      order: 3,
      visibility: true,
      status: 'ACTIVE' as any,
      contractTypeVisibility: 'ALL',
    },
  ];

  const itemPermissionsMap = new Map<string, string[]>([
    ['web2_admin_roles', ['roles.manage']],
    ['web2_admin_users', ['users.manage']],
  ]);

  beforeEach(() => {
    mockNavRepo = {
      findActiveVisibleMenuItems: jest.fn().mockResolvedValue(web2MenuItems),
      findMenuItemPermissionsByItemIds: jest.fn().mockResolvedValue(itemPermissionsMap),
    };
    mockEffectivePerms = {
      getEffectivePermissions: jest.fn().mockResolvedValue(['roles.manage', 'users.manage']),
      getUserRoles: jest.fn().mockResolvedValue(['SYSTEM_ADMIN']),
    } as any;

    navigationService = new NavigationService(
      mockNavRepo,
      mockEffectivePerms,
      undefined,
      undefined,
    );

    loggerWarnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    computeCapabilitiesSpy = jest.spyOn(navigationService, 'computeUserCapabilities');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Requirement 1: WEB_2 Menu Navigation uses pure Role/Permission filtering', () => {
    it('returns exact legacy navigation tree for SYSTEM_ADMIN without invoking computeUserCapabilities', async () => {
      const result = await navigationService.getUserNavigation(
        'admin-user-id',
        ApplicationContext.WEB_2,
        { role: 'SYSTEM_ADMIN' },
        'admin@admin.com',
      );

      // Verify computeUserCapabilities was NOT called for WEB_2
      expect(computeCapabilitiesSpy).not.toHaveBeenCalled();

      // Verify NO capability warning logs were generated
      const capabilityWarnings = loggerWarnSpy.mock.calls.filter((args) =>
        args[0] && typeof args[0] === 'string' && args[0].includes('has no capability assigned'),
      );
      expect(capabilityWarnings).toHaveLength(0);

      // Verify tree structure matches expectations
      expect(result).toHaveLength(2); // Two root groups: Dashboard Group & Administration
      const adminGroup = result.find((g) => g.id === 'web2_group_admin');
      expect(adminGroup).toBeDefined();
      expect(adminGroup!.children).toHaveLength(2); // Roles & Users
    });

    it('returns exact legacy navigation tree for ADMIN role', async () => {
      mockEffectivePerms.getUserRoles.mockResolvedValue(['ADMIN']);
      mockEffectivePerms.getEffectivePermissions.mockResolvedValue(['roles.manage', 'users.manage']);

      const result = await navigationService.getUserNavigation(
        'admin-user-id',
        ApplicationContext.WEB_2,
        { role: 'ADMIN' },
        'admin@admin.com',
      );

      expect(computeCapabilitiesSpy).not.toHaveBeenCalled();
      expect(loggerWarnSpy).not.toHaveBeenCalled();
      expect(result.some((g) => g.id === 'web2_group_admin')).toBe(true);
    });

    it('filters out items when role lacks required permissions without throwing or logging capability warnings', async () => {
      mockEffectivePerms.getUserRoles.mockResolvedValue(['SALES_MANAGER']);
      mockEffectivePerms.getEffectivePermissions.mockResolvedValue(['sales.leads.view']);

      const result = await navigationService.getUserNavigation(
        'sales-user-id',
        ApplicationContext.WEB_2,
        { role: 'SALES_MANAGER' },
        'sales@admin.com',
      );

      expect(computeCapabilitiesSpy).not.toHaveBeenCalled();
      expect(loggerWarnSpy).not.toHaveBeenCalled();

      // Admin group had 2 items (roles.manage, users.manage), sales has neither -> admin group is pruned
      const adminGroup = result.find((g) => g.id === 'web2_group_admin');
      expect(adminGroup).toBeUndefined();
    });
  });

  describe('Requirement 2: WEB_3 warns missing capability at most ONCE per key', () => {
    const web3TestItems: IMenuItemData[] = [
      {
        id: 'web3_uncapped_item',
        key: 'web3.uncapped.item',
        application: ApplicationContext.WEB_3,
        label: 'Uncapped Item',
        type: 'PAGE' as any,
        icon: 'File',
        route: '/uncapped',
        parentId: null,
        order: 1,
        visibility: true,
        status: 'ACTIVE' as any,
        contractTypeVisibility: 'ALL',
        // Notice: NO capability assigned
      },
    ];

    it('logs warning at most once even across 10 repeated requests', async () => {
      mockNavRepo.findActiveVisibleMenuItems.mockResolvedValue(web3TestItems);
      mockNavRepo.findMenuItemPermissionsByItemIds.mockResolvedValue(new Map());

      for (let i = 0; i < 10; i++) {
        await navigationService.getUserNavigation(
          'user-1',
          ApplicationContext.WEB_3,
          { role: 'PARTNER' },
          'user@partner.com',
        );
      }

      // computeUserCapabilities IS called for WEB_3
      expect(computeCapabilitiesSpy).toHaveBeenCalledTimes(10);

      // Warning was logged exactly ONCE for web3.uncapped.item
      const capabilityWarnings = loggerWarnSpy.mock.calls.filter((args) =>
        args[0] && typeof args[0] === 'string' && args[0].includes('web3.uncapped.item'),
      );
      expect(capabilityWarnings).toHaveLength(1);
    });
  });
});
