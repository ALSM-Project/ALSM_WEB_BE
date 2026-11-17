import { Test, TestingModule } from '@nestjs/testing';
import { ApplicationContext, MenuItemStatus, MenuItemType } from '../src/modules/menus/domain/enums/menu.enums';
import { NavigationService } from '../src/modules/menus/application/services/navigation.service';
import { MenuBuilderService } from '../src/modules/menus/application/services/menu-builder.service';
import { EffectivePermissionsService } from '../src/modules/rbac/application/effective-permissions.service';
import {
  IMenuItemData,
  IMenuBuilderRepository,
  INavigationRepository,
  NAVIGATION_REPOSITORY,
  MENU_BUILDER_REPOSITORY,
} from '../src/modules/menus/domain/interfaces/menu-builder.repository.interface';
import { ConflictException } from '@nestjs/common';

describe('Web 3 Contract Type & Role/Permission Dynamic Sidebar Specification', () => {
  let navigationService: NavigationService;
  let menuBuilderService: MenuBuilderService;
  let mockNavRepo: jest.Mocked<INavigationRepository>;
  let mockMenuBuilderRepo: jest.Mocked<IMenuBuilderRepository>;
  let mockEffectivePerms: jest.Mocked<EffectivePermissionsService>;

  const web3SampleMenuItems: IMenuItemData[] = [
    // Shared
    {
      id: 'web3_dashboard',
      key: 'web3.dashboard',
      application: ApplicationContext.WEB_3,
      label: 'Partner Dashboard',
      type: MenuItemType.PAGE,
      icon: 'LayoutDashboard',
      route: '/dashboard',
      parentId: null,
      order: 1,
      visibility: true,
      status: MenuItemStatus.ACTIVE,
      contractTypeVisibility: 'ALL',
    },
    {
      id: 'web3_projects',
      key: 'web3.projects',
      application: ApplicationContext.WEB_3,
      label: 'My Projects',
      type: MenuItemType.PAGE,
      icon: 'Layers',
      route: '/projects',
      parentId: null,
      order: 2,
      visibility: true,
      status: MenuItemStatus.ACTIVE,
      contractTypeVisibility: 'ALL',
    },
    // Self-Service specific
    {
      id: 'web3_screens',
      key: 'web3.screens',
      application: ApplicationContext.WEB_3,
      label: 'Screens & Programs',
      type: MenuItemType.PAGE,
      icon: 'Monitor',
      route: '/screens',
      parentId: null,
      order: 3,
      visibility: true,
      status: MenuItemStatus.ACTIVE,
      contractTypeVisibility: 'SELF_SERVICE',
    },
    {
      id: 'web3_history',
      key: 'web3.history',
      application: ApplicationContext.WEB_3,
      label: 'Conversion History',
      type: MenuItemType.PAGE,
      icon: 'History',
      route: '/conversion-history',
      parentId: null,
      order: 4,
      visibility: true,
      status: MenuItemStatus.ACTIVE,
      contractTypeVisibility: 'SELF_SERVICE',
    },
    // We Convert for You specific
    {
      id: 'web3_requests',
      key: 'web3.requests',
      application: ApplicationContext.WEB_3,
      label: 'Conversion Requests',
      type: MenuItemType.PAGE,
      icon: 'Send',
      route: '/conversion-requests',
      parentId: null,
      order: 5,
      visibility: true,
      status: MenuItemStatus.ACTIVE,
      contractTypeVisibility: 'WE_CONVERT_FOR_YOU',
    },
    {
      id: 'web3_progress',
      key: 'web3.progress',
      application: ApplicationContext.WEB_3,
      label: 'Project Progress',
      type: MenuItemType.PAGE,
      icon: 'TrendingUp',
      route: '/project-progress',
      parentId: null,
      order: 6,
      visibility: true,
      status: MenuItemStatus.ACTIVE,
      contractTypeVisibility: 'WE_CONVERT_FOR_YOU',
    },
    // Shared Downloads
    {
      id: 'web3_downloads',
      key: 'web3.downloads',
      application: ApplicationContext.WEB_3,
      label: 'Downloads',
      type: MenuItemType.PAGE,
      icon: 'Download',
      route: '/downloads',
      parentId: null,
      order: 7,
      visibility: true,
      status: MenuItemStatus.ACTIVE,
      contractTypeVisibility: 'ALL',
    },
    // Self-Service Workspace Group
    {
      id: 'web3_group_workspace',
      key: 'web3.group.workspace',
      application: ApplicationContext.WEB_3,
      label: 'Workspace',
      type: MenuItemType.GROUP,
      icon: 'Cpu',
      route: null,
      parentId: null,
      order: 8,
      visibility: true,
      status: MenuItemStatus.ACTIVE,
      contractTypeVisibility: 'SELF_SERVICE',
    },
    {
      id: 'web3_workspace_queue',
      key: 'web3.workspace.queue',
      application: ApplicationContext.WEB_3,
      label: 'Conversion Queue',
      type: MenuItemType.PAGE,
      icon: 'ListOrdered',
      route: '/conversion-queue',
      parentId: 'web3_group_workspace',
      order: 1,
      visibility: true,
      status: MenuItemStatus.ACTIVE,
      contractTypeVisibility: 'SELF_SERVICE',
    },
    // We Convert for You Project Management Group
    {
      id: 'web3_group_project_management',
      key: 'web3.group.project_management',
      application: ApplicationContext.WEB_3,
      label: 'Project Management',
      type: MenuItemType.GROUP,
      icon: 'FolderKanban',
      route: null,
      parentId: null,
      order: 9,
      visibility: true,
      status: MenuItemStatus.ACTIVE,
      contractTypeVisibility: 'WE_CONVERT_FOR_YOU',
    },
    {
      id: 'web3_mng_deliverables',
      key: 'web3.mng.deliverables',
      application: ApplicationContext.WEB_3,
      label: 'Conversion Deliverables',
      type: MenuItemType.PAGE,
      icon: 'ShieldCheck',
      route: '/deliverables',
      parentId: 'web3_group_project_management',
      order: 1,
      visibility: true,
      status: MenuItemStatus.ACTIVE,
      contractTypeVisibility: 'WE_CONVERT_FOR_YOU',
    },
    // Service & Contract Group
    {
      id: 'web3_group_service_contract',
      key: 'web3.group.service_contract',
      application: ApplicationContext.WEB_3,
      label: 'Service & Contract',
      type: MenuItemType.GROUP,
      icon: 'CreditCard',
      route: null,
      parentId: null,
      order: 10,
      visibility: true,
      status: MenuItemStatus.ACTIVE,
      contractTypeVisibility: 'ALL',
    },
    {
      id: 'web3_billing_contracts',
      key: 'web3.billing.contracts',
      application: ApplicationContext.WEB_3,
      label: 'Contract & Subscription',
      type: MenuItemType.PAGE,
      icon: 'FileText',
      route: '/billing/contracts',
      parentId: 'web3_group_service_contract',
      order: 1,
      visibility: true,
      status: MenuItemStatus.ACTIVE,
      contractTypeVisibility: 'ALL',
    },
  ];

  const permissionsMap = new Map<string, string[]>([
    ['web3_dashboard', ['partner_portal.dashboard.view']],
    ['web3_projects', ['projects.view']],
    ['web3_screens', ['projects.view']],
    ['web3_history', ['conversion.history.view']],
    ['web3_requests', ['conversion_requests.view']],
    ['web3_progress', ['project_progress.view']],
    ['web3_downloads', ['project_files.download']],
    ['web3_group_workspace', []],
    ['web3_workspace_queue', ['conversion.view']],
    ['web3_group_project_management', []],
    ['web3_mng_deliverables', ['project_deliverables.view']],
    ['web3_group_service_contract', []],
    ['web3_billing_contracts', ['contracts.view']],
  ]);

  beforeEach(async () => {
    mockNavRepo = {
      findActiveVisibleMenuItems: jest.fn().mockResolvedValue(web3SampleMenuItems),
      findMenuItemPermissionsByItemIds: jest.fn().mockResolvedValue(permissionsMap),
    };

    mockMenuBuilderRepo = {
      findMenuItemsByApp: jest.fn().mockResolvedValue(web3SampleMenuItems),
      findMenuItemById: jest.fn(),
      findMenuItemByKey: jest.fn().mockResolvedValue(null),
      findMenuItemPermissionsByItemIds: jest.fn().mockResolvedValue(permissionsMap),
      findMenuItemPermissions: jest.fn().mockResolvedValue([]),
      createMenuItem: jest.fn(),
      updateMenuItem: jest.fn(),
      deleteMenuItem: jest.fn(),
      countChildren: jest.fn(),
      getDescendantIds: jest.fn().mockResolvedValue([]),
      reorderMenuItems: jest.fn(),
      findSiblings: jest.fn().mockResolvedValue([]),
      updateOrders: jest.fn(),
      validatePermissionsExist: jest.fn().mockResolvedValue(true),
      getInvalidPermissionKeys: jest.fn().mockResolvedValue([]),
    };

    mockEffectivePerms = {
      getEffectivePermissions: jest.fn().mockResolvedValue([
        'partner_portal.dashboard.view',
        'projects.view',
        'conversion.history.view',
        'conversion.view',
        'conversion_requests.view',
        'project_progress.view',
        'project_deliverables.view',
        'project_files.download',
        'contracts.view',
      ]),
      getUserRoles: jest.fn().mockResolvedValue(['ORGANIZATION_OWNER']),
    } as unknown as jest.Mocked<EffectivePermissionsService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NavigationService,
        MenuBuilderService,
        { provide: NAVIGATION_REPOSITORY, useValue: mockNavRepo },
        { provide: MENU_BUILDER_REPOSITORY, useValue: mockMenuBuilderRepo },
        { provide: EffectivePermissionsService, useValue: mockEffectivePerms },
      ],
    }).compile();

    navigationService = module.get<NavigationService>(NavigationService);
    menuBuilderService = module.get<MenuBuilderService>(MenuBuilderService);
  });

  describe('1. Contract-Based Sidebar Filtering', () => {
    it('returns Self-Service sidebar items and excludes Managed Conversion items for SELF_SERVICE contract', async () => {
      const tree = await navigationService.getUserNavigation('user-1', ApplicationContext.WEB_3, {
        contractType: 'SELF_SERVICE',
      });

      const flatKeys: string[] = [];
      const collect = (nodes: any[]) => {
        for (const n of nodes) {
          flatKeys.push(n.key);
          if (n.children) collect(n.children);
        }
      };
      collect(tree);

      // Must include Self-Service
      expect(flatKeys).toContain('web3.dashboard');
      expect(flatKeys).toContain('web3.projects');
      expect(flatKeys).toContain('web3.screens');
      expect(flatKeys).toContain('web3.history');
      expect(flatKeys).toContain('web3.group.workspace');
      expect(flatKeys).toContain('web3.workspace.queue');

      // Must NOT include We Convert for You
      expect(flatKeys).not.toContain('web3.requests');
      expect(flatKeys).not.toContain('web3.progress');
      expect(flatKeys).not.toContain('web3.group.project_management');
      expect(flatKeys).not.toContain('web3.mng.deliverables');
    });

    it('returns Managed Conversion items and excludes Self-Service items for WE_CONVERT_FOR_YOU contract', async () => {
      const tree = await navigationService.getUserNavigation('user-2', ApplicationContext.WEB_3, {
        contractType: 'WE_CONVERT_FOR_YOU',
      });

      const flatKeys: string[] = [];
      const collect = (nodes: any[]) => {
        for (const n of nodes) {
          flatKeys.push(n.key);
          if (n.children) collect(n.children);
        }
      };
      collect(tree);

      // Must include We Convert for You
      expect(flatKeys).toContain('web3.dashboard');
      expect(flatKeys).toContain('web3.projects');
      expect(flatKeys).toContain('web3.requests');
      expect(flatKeys).toContain('web3.progress');
      expect(flatKeys).toContain('web3.group.project_management');
      expect(flatKeys).toContain('web3.mng.deliverables');

      // Must NOT include Self-Service
      expect(flatKeys).not.toContain('web3.screens');
      expect(flatKeys).not.toContain('web3.history');
      expect(flatKeys).not.toContain('web3.group.workspace');
      expect(flatKeys).not.toContain('web3.workspace.queue');
    });

    it('returns both Self-Service and Managed items without duplication for HYBRID contract', async () => {
      const tree = await navigationService.getUserNavigation('user-3', ApplicationContext.WEB_3, {
        contractType: 'HYBRID',
      });

      const flatKeys: string[] = [];
      const collect = (nodes: any[]) => {
        for (const n of nodes) {
          flatKeys.push(n.key);
          if (n.children) collect(n.children);
        }
      };
      collect(tree);

      expect(flatKeys).toContain('web3.screens');
      expect(flatKeys).toContain('web3.requests');
      expect(flatKeys).toContain('web3.group.workspace');
      expect(flatKeys).toContain('web3.group.project_management');

      // Check no duplicate keys
      const uniqueKeys = new Set(flatKeys);
      expect(uniqueKeys.size).toBe(flatKeys.length);
    });
  });

  describe('2. Role and Permission Dynamic Filtering', () => {
    it('hides conversion execution & history when user role lacks conversion permissions', async () => {
      mockEffectivePerms.getEffectivePermissions.mockResolvedValueOnce([
        'partner_portal.dashboard.view',
        'projects.view',
        'contracts.view',
        // Missing conversion.history.view and conversion.view
      ]);

      const tree = await navigationService.getUserNavigation('viewer-user', ApplicationContext.WEB_3, {
        contractType: 'SELF_SERVICE',
        role: 'VIEWER',
      });

      const flatKeys: string[] = [];
      const collect = (nodes: any[]) => {
        for (const n of nodes) {
          flatKeys.push(n.key);
          if (n.children) collect(n.children);
        }
      };
      collect(tree);

      expect(flatKeys).toContain('web3.dashboard');
      expect(flatKeys).toContain('web3.projects');
      expect(flatKeys).not.toContain('web3.history');
      expect(flatKeys).not.toContain('web3.workspace.queue');
    });
  });

  describe('3. Menu Builder Validation & Integrity', () => {
    it('prevents creating menu item with duplicate route in the same application', async () => {
      await expect(
        menuBuilderService.createMenuItem({
          key: 'new.screens',
          application: ApplicationContext.WEB_3,
          label: 'Screens Duplicate',
          type: MenuItemType.PAGE,
          route: '/screens', // duplicate of web3_screens
        }),
      ).rejects.toThrow(ConflictException);
    });
  });
});
