import { Test, TestingModule } from '@nestjs/testing';
import { ApplicationContext, MenuItemStatus, MenuItemType } from '../src/modules/menus/domain/enums/menu.enums';
import { MenuBuilderService } from '../src/modules/menus/application/services/menu-builder.service';
import { NavigationService } from '../src/modules/menus/application/services/navigation.service';
import { EffectivePermissionsService } from '../src/modules/rbac/application/effective-permissions.service';
import {
  IMenuBuilderRepository,
  IMenuItemData,
  INavigationRepository,
  MENU_BUILDER_REPOSITORY,
  NAVIGATION_REPOSITORY,
} from '../src/modules/menus/domain/interfaces/menu-builder.repository.interface';
import { ConflictException } from '@nestjs/common';

describe('Centralized Menu Builder — Target Application Isolation (WEB_1, WEB_2, WEB_3)', () => {
  let menuBuilderService: MenuBuilderService;
  let navigationService: NavigationService;

  // In-memory store simulating MongoDB collection 'menu_items'
  const inMemoryDatabase: IMenuItemData[] = [];
  const inMemoryPermissions = new Map<string, string[]>();

  const mockMenuBuilderRepo: Partial<IMenuBuilderRepository> = {
    findMenuItemsByApp: jest.fn(async (app: ApplicationContext) => {
      return inMemoryDatabase.filter((item) => item.application === app);
    }),
    findMenuItemById: jest.fn(async (id: string) => {
      return inMemoryDatabase.find((item) => item.id === id) || null;
    }),
    findMenuItemByKey: jest.fn(async (key: string, app: ApplicationContext) => {
      return inMemoryDatabase.find((item) => item.key === key && item.application === app) || null;
    }),
    findMenuItemPermissionsByItemIds: jest.fn(async (itemIds: string[]) => {
      const map = new Map<string, string[]>();
      for (const id of itemIds) {
        map.set(id, inMemoryPermissions.get(id) || []);
      }
      return map;
    }),
    findMenuItemPermissions: jest.fn(async (id: string) => {
      return inMemoryPermissions.get(id) || [];
    }),
    createMenuItem: jest.fn(async (data: Partial<IMenuItemData>, permissions: string[] = []) => {
      const newItem: IMenuItemData = {
        id: data.id || `item_${Date.now()}_${Math.random()}`,
        key: data.key!,
        application: data.application!,
        label: data.label!,
        type: data.type || MenuItemType.PAGE,
        icon: data.icon || 'FileText',
        route: data.route || null,
        parentId: data.parentId || null,
        order: data.order || 1,
        visibility: data.visibility !== undefined ? data.visibility : true,
        status: data.status || MenuItemStatus.ACTIVE,
        openInNewTab: data.openInNewTab || false,
      };
      inMemoryDatabase.push(newItem);
      inMemoryPermissions.set(newItem.id, permissions);
      return newItem;
    }),
    updateMenuItem: jest.fn(async (id: string, data: Partial<IMenuItemData>, permissions?: string[]) => {
      const idx = inMemoryDatabase.findIndex((item) => item.id === id);
      if (idx === -1) return null;
      inMemoryDatabase[idx] = { ...inMemoryDatabase[idx], ...data };
      if (permissions) {
        inMemoryPermissions.set(id, permissions);
      }
      return inMemoryDatabase[idx];
    }),
    deleteMenuItem: jest.fn(async (id: string) => {
      const idx = inMemoryDatabase.findIndex((item) => item.id === id);
      if (idx !== -1) {
        inMemoryDatabase.splice(idx, 1);
        inMemoryPermissions.delete(id);
      }
    }),
    countChildren: jest.fn(async (parentId: string) => {
      return inMemoryDatabase.filter((item) => item.parentId === parentId).length;
    }),
    getDescendantIds: jest.fn(async (nodeId: string) => {
      const descendants: string[] = [];
      const queue = [nodeId];
      while (queue.length > 0) {
        const curr = queue.shift()!;
        const children = inMemoryDatabase.filter((i) => i.parentId === curr).map((i) => i.id);
        descendants.push(...children);
        queue.push(...children);
      }
      return descendants;
    }),
    validatePermissionsExist: jest.fn(async () => true),
    getInvalidPermissionKeys: jest.fn(async () => []),
  };

  const mockNavigationRepo: Partial<INavigationRepository> = {
    findActiveVisibleMenuItems: jest.fn(async (app: ApplicationContext) => {
      return inMemoryDatabase.filter(
        (i) => i.application === app && i.visibility && i.status === MenuItemStatus.ACTIVE,
      );
    }),
    findMenuItemPermissionsByItemIds: jest.fn(async (itemIds: string[]) => {
      const map = new Map<string, string[]>();
      for (const id of itemIds) {
        map.set(id, inMemoryPermissions.get(id) || []);
      }
      return map;
    }),
  };

  const mockEffectivePermissionsService = {
    getEffectivePermissions: jest.fn(async (userId: string) => {
      if (userId === 'partner_lead') {
        return [
          'partner_portal.dashboard.view',
          'partner_portal.project.view',
          'partner_portal.download',
        ];
      }
      if (userId === 'admin_user') {
        return ['*'];
      }
      return [];
    }),
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MenuBuilderService,
        NavigationService,
        {
          provide: MENU_BUILDER_REPOSITORY,
          useValue: mockMenuBuilderRepo,
        },
        {
          provide: NAVIGATION_REPOSITORY,
          useValue: mockNavigationRepo,
        },
        {
          provide: EffectivePermissionsService,
          useValue: mockEffectivePermissionsService,
        },
      ],
    }).compile();

    menuBuilderService = module.get<MenuBuilderService>(MenuBuilderService);
    navigationService = module.get<NavigationService>(NavigationService);
  });

  beforeEach(() => {
    inMemoryDatabase.length = 0;
    inMemoryPermissions.clear();

    // Seed initial items for all 3 apps
    // WEB_1
    inMemoryDatabase.push(
      {
        id: 'web1_dashboard',
        key: 'web1.dashboard',
        application: ApplicationContext.WEB_1,
        label: 'Dashboard',
        type: MenuItemType.PAGE,
        icon: 'LayoutDashboard',
        route: '/dashboard',
        parentId: null,
        order: 1,
        visibility: true,
        status: MenuItemStatus.ACTIVE,
      },
      {
        id: 'web1_projects',
        key: 'web1.projects',
        application: ApplicationContext.WEB_1,
        label: 'Projects',
        type: MenuItemType.PAGE,
        icon: 'Layers',
        route: '/projects',
        parentId: null,
        order: 2,
        visibility: true,
        status: MenuItemStatus.ACTIVE,
      },
    );

    // WEB_2
    inMemoryDatabase.push({
      id: 'web2_dashboard',
      key: 'web2.dashboard',
      application: ApplicationContext.WEB_2,
      label: 'Staff Dashboard',
      type: MenuItemType.PAGE,
      icon: 'LayoutDashboard',
      route: '/',
      parentId: null,
      order: 1,
      visibility: true,
      status: MenuItemStatus.ACTIVE,
    });

    // WEB_3
    inMemoryDatabase.push(
      {
        id: 'web3_dashboard',
        key: 'web3.dashboard',
        application: ApplicationContext.WEB_3,
        label: 'Partner Dashboard',
        type: MenuItemType.PAGE,
        icon: 'LayoutDashboard',
        route: '/portal/dashboard',
        parentId: null,
        order: 1,
        visibility: true,
        status: MenuItemStatus.ACTIVE,
      },
      {
        id: 'web3_projects',
        key: 'web3.projects',
        application: ApplicationContext.WEB_3,
        label: 'My Projects',
        type: MenuItemType.PAGE,
        icon: 'FolderKanban',
        route: '/portal/projects',
        parentId: null,
        order: 2,
        visibility: true,
        status: MenuItemStatus.ACTIVE,
      },
      {
        id: 'web3_downloads',
        key: 'web3.downloads',
        application: ApplicationContext.WEB_3,
        label: 'Downloads',
        type: MenuItemType.PAGE,
        icon: 'DownloadCloud',
        route: '/portal/downloads',
        parentId: null,
        order: 3,
        visibility: true,
        status: MenuItemStatus.ACTIVE,
      },
    );

    inMemoryPermissions.set('web3_dashboard', ['partner_portal.dashboard.view']);
    inMemoryPermissions.set('web3_projects', ['partner_portal.project.view']);
    inMemoryPermissions.set('web3_downloads', ['partner_portal.download']);
  });

  describe('1. Target Application Retrieval Isolation', () => {
    it('returns only WEB_1 menu items when querying WEB_1 target', async () => {
      const tree = await menuBuilderService.getAdminMenuTree(ApplicationContext.WEB_1);
      expect(tree).toHaveLength(2);
      expect(tree.every((i) => i.application === ApplicationContext.WEB_1)).toBe(true);
      expect(tree.map((i) => i.id)).toEqual(['web1_dashboard', 'web1_projects']);
    });

    it('returns only WEB_2 menu items when querying WEB_2 target', async () => {
      const tree = await menuBuilderService.getAdminMenuTree(ApplicationContext.WEB_2);
      expect(tree).toHaveLength(1);
      expect(tree[0].id).toBe('web2_dashboard');
      expect(tree[0].application).toBe(ApplicationContext.WEB_2);
    });

    it('returns only WEB_3 menu items when querying WEB_3 target', async () => {
      const tree = await menuBuilderService.getAdminMenuTree(ApplicationContext.WEB_3);
      expect(tree).toHaveLength(3);
      expect(tree.every((i) => i.application === ApplicationContext.WEB_3)).toBe(true);
      expect(tree.map((i) => i.id)).toEqual(['web3_dashboard', 'web3_projects', 'web3_downloads']);
    });
  });

  describe('2. Mutation Isolation across Target Applications', () => {
    it('creating an item in WEB_1 does not affect WEB_2 or WEB_3', async () => {
      await menuBuilderService.createMenuItem(
        {
          key: 'web1.custom',
          application: ApplicationContext.WEB_1,
          label: 'Custom PoC Page',
          type: MenuItemType.PAGE,
          icon: 'FileCode',
          route: '/custom',
          parentId: null,
        },
        'admin_user',
      );

      const tree1 = await menuBuilderService.getAdminMenuTree(ApplicationContext.WEB_1);
      const tree2 = await menuBuilderService.getAdminMenuTree(ApplicationContext.WEB_2);
      const tree3 = await menuBuilderService.getAdminMenuTree(ApplicationContext.WEB_3);

      expect(tree1).toHaveLength(3);
      expect(tree2).toHaveLength(1);
      expect(tree3).toHaveLength(3);
    });

    it('creating an item in WEB_3 does not affect WEB_1 or WEB_2', async () => {
      await menuBuilderService.createMenuItem(
        {
          key: 'web3.organization',
          application: ApplicationContext.WEB_3,
          label: 'Organisation Analytics',
          type: MenuItemType.PAGE,
          icon: 'TrendingUp',
          route: '/organisation/analytics',
          parentId: null,
        },
        'admin_user',
      );

      const tree1 = await menuBuilderService.getAdminMenuTree(ApplicationContext.WEB_1);
      const tree2 = await menuBuilderService.getAdminMenuTree(ApplicationContext.WEB_2);
      const tree3 = await menuBuilderService.getAdminMenuTree(ApplicationContext.WEB_3);

      expect(tree1).toHaveLength(2);
      expect(tree2).toHaveLength(1);
      expect(tree3).toHaveLength(4);
    });

    it('updating an item in WEB_3 preserves WEB_1 and WEB_2 intact', async () => {
      await menuBuilderService.updateMenuItem(
        'web3_dashboard',
        { label: 'Updated Partner Dashboard' },
        'admin_user',
      );

      const item3 = await mockMenuBuilderRepo.findMenuItemById!('web3_dashboard');
      const item1 = await mockMenuBuilderRepo.findMenuItemById!('web1_dashboard');

      expect(item3?.label).toBe('Updated Partner Dashboard');
      expect(item1?.label).toBe('Dashboard');
    });

    it('deleting an item in WEB_1 preserves WEB_2 and WEB_3 intact', async () => {
      await menuBuilderService.deleteMenuItem('web1_projects', 'admin_user');

      const tree1 = await menuBuilderService.getAdminMenuTree(ApplicationContext.WEB_1);
      const tree2 = await menuBuilderService.getAdminMenuTree(ApplicationContext.WEB_2);
      const tree3 = await menuBuilderService.getAdminMenuTree(ApplicationContext.WEB_3);

      expect(tree1.map((i) => i.id)).toEqual(['web1_dashboard']);
      expect(tree2).toHaveLength(1);
      expect(tree3).toHaveLength(3);
    });
  });

  describe('3. Runtime Navigation Service Delivery', () => {
    it('returns runtime navigation for WEB_1 unconstrained by partner permissions', async () => {
      const userNav = await navigationService.getUserNavigation('any_user', ApplicationContext.WEB_1);
      expect(userNav).toHaveLength(2);
      expect(userNav.map((i) => i.id)).toEqual(['web1_dashboard', 'web1_projects']);
    });

    it('returns runtime navigation for WEB_3 filtered strictly by partner permissions', async () => {
      const partnerNav = await navigationService.getUserNavigation('partner_lead', ApplicationContext.WEB_3);
      expect(partnerNav).toHaveLength(3);
      expect(partnerNav.map((i) => i.id)).toEqual(['web3_dashboard', 'web3_projects', 'web3_downloads']);
    });
  });
});
