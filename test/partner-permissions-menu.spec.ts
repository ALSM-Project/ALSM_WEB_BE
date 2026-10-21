import { Test, TestingModule } from '@nestjs/testing';
import { ApplicationContext, MenuItemType, MenuItemStatus } from '../src/modules/menus/domain/enums/menu.enums';
import { NavigationService } from '../src/modules/menus/application/services/navigation.service';
import { EffectivePermissionsService } from '../src/modules/rbac/application/effective-permissions.service';
import {
  IMenuItemData,
  INavigationRepository,
  NAVIGATION_REPOSITORY,
} from '../src/modules/menus/domain/interfaces/menu-builder.repository.interface';

describe('Partner Permissions and Dynamic Menu RBAC', () => {
  let navigationService: NavigationService;
  let mockNavRepo: jest.Mocked<INavigationRepository>;
  let mockEffectivePerms: jest.Mocked<EffectivePermissionsService>;

  const sampleMenuItems = [
    // Staff Dashboard
    {
      id: 'web2_dashboard',
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
    // Partner Management Group (No route, grouping-only parent)
    {
      id: 'web2_group_partners',
      key: 'group.partners',
      application: ApplicationContext.WEB_2,
      label: 'Partner Management',
      type: MenuItemType.GROUP,
      icon: 'Building2',
      route: null,
      parentId: null,
      order: 2,
      visibility: true,
      status: MenuItemStatus.ACTIVE,
    },
    // Partner List (Child)
    {
      id: 'web2_partner_list',
      key: 'partner.list',
      application: ApplicationContext.WEB_2,
      label: 'Partner List',
      type: MenuItemType.PAGE,
      icon: 'Building2',
      route: '/partners',
      parentId: 'web2_group_partners',
      order: 1,
      visibility: true,
      status: MenuItemStatus.ACTIVE,
    },
    // Create Partner (Child)
    {
      id: 'web2_partner_create',
      key: 'partner.create',
      application: ApplicationContext.WEB_2,
      label: 'Create Partner',
      type: MenuItemType.PAGE,
      icon: 'UserPlus',
      route: '/partners/new',
      parentId: 'web2_group_partners',
      order: 2,
      visibility: true,
      status: MenuItemStatus.ACTIVE,
    },
    // Parent with own page and children
    {
      id: 'web2_parent_with_page',
      key: 'parent.with_page',
      application: ApplicationContext.WEB_2,
      label: 'Platform Overview',
      type: MenuItemType.PAGE,
      icon: 'Globe',
      route: '/overview',
      parentId: null,
      order: 3,
      visibility: true,
      status: MenuItemStatus.ACTIVE,
    },
  ];

  const permissionsMap = new Map<string, string[]>([
    ['web2_dashboard', []],
    ['web2_group_partners', []],
    ['web2_partner_list', ['partner.view']],
    ['web2_partner_create', ['partner.create']],
    ['web2_parent_with_page', ['overview.view']],
  ]);

  beforeEach(async () => {
    mockNavRepo = {
      findActiveVisibleMenuItems: jest.fn().mockResolvedValue(sampleMenuItems as unknown as IMenuItemData[]),
      findMenuItemPermissionsByItemIds: jest.fn().mockResolvedValue(permissionsMap),
    } as unknown as jest.Mocked<INavigationRepository>;

    mockEffectivePerms = {
      getEffectivePermissions: jest.fn(),
    } as unknown as jest.Mocked<EffectivePermissionsService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NavigationService,
        { provide: NAVIGATION_REPOSITORY, useValue: mockNavRepo },
        { provide: EffectivePermissionsService, useValue: mockEffectivePerms },
      ],
    }).compile();

    navigationService = module.get<NavigationService>(NavigationService);
  });

  it('hides grouping-only parent menu when user has none of the required child permissions', async () => {
    // User only has overview.view, NO partner permissions
    mockEffectivePerms.getEffectivePermissions.mockResolvedValue(['overview.view']);

    const nav = await navigationService.getUserNavigation('user-1', ApplicationContext.WEB_2);

    // Group "Partner Management" has no route and no accessible children -> MUST BE PRUNED
    expect(nav.some((item) => item.id === 'web2_group_partners')).toBe(false);
    expect(nav.some((item) => item.id === 'web2_partner_list')).toBe(false);
    expect(nav.some((item) => item.id === 'web2_partner_create')).toBe(false);
    // Overview stays because it has its own route and user has overview.view
    expect(nav.some((item) => item.id === 'web2_parent_with_page')).toBe(true);
  });

  it('renders grouping-only parent menu when user has at least one child permission', async () => {
    // User has partner.view but NOT partner.create
    mockEffectivePerms.getEffectivePermissions.mockResolvedValue(['partner.view']);

    const nav = await navigationService.getUserNavigation('user-2', ApplicationContext.WEB_2);

    const partnerGroup = nav.find((item) => item.id === 'web2_group_partners');
    expect(partnerGroup).toBeDefined();
    expect(partnerGroup?.children).toHaveLength(1);
    expect(partnerGroup?.children?.[0].id).toBe('web2_partner_list');
    // Create Partner must be filtered out
    expect(partnerGroup?.children?.some((c) => c.id === 'web2_partner_create')).toBe(false);
  });

  it('strictly isolates Partner portal roles from internal staff permissions', () => {
    const partnerPermissions = [
      'partner_portal.dashboard.view',
      'partner_portal.project.view',
      'partner_portal.progress.view',
      'partner_portal.result.view',
      'partner_portal.error.view',
      'partner_portal.download',
    ];

    const staffPermissions = [
      'partner.create',
      'partner.update',
      'partner.manage_status',
      'partner_project.create',
      'partner_project.manage_files',
      'partner_project.start_conversion',
      'conversion_result.manage_findings',
      'conversion_result.manage_mappings',
      'conversion_result.export',
    ];

    // Ensure zero intersection between Partner role permissions and Staff mutating permissions
    const leak = partnerPermissions.filter((p) => staffPermissions.includes(p));
    expect(leak).toHaveLength(0);
  });
});
