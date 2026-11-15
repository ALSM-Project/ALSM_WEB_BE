import { ApplicationContext } from '../src/modules/menus/domain/enums/menu.enums';
import { NavigationService, NavNode } from '../src/modules/menus/application/services/navigation.service';
import {
  CAPABILITY_REGISTRY,
  VALID_CAPABILITY_KEYS,
  isValidCapability,
} from '../src/modules/menus/domain/capabilities.constants';
import {
  INavigationRepository,
  IMenuItemData,
} from '../src/modules/menus/domain/interfaces/menu-builder.repository.interface';
import { EffectivePermissionsService } from '../src/modules/rbac/application/effective-permissions.service';

describe('WEB_3 Menu Capabilities Matrix Test (Big Tech Entitlements Specification)', () => {
  let navigationService: NavigationService;
  let mockNavRepo: jest.Mocked<INavigationRepository>;
  let mockEffectivePerms: jest.Mocked<EffectivePermissionsService>;

  // All 38 WEB_3 items from authoritative seed/DB
  const web3MenuItems: IMenuItemData[] = [
    { id: 'web3_dashboard', key: 'web3.dashboard', application: ApplicationContext.WEB_3, label: 'Dashboard', type: 'PAGE' as any, icon: 'LayoutDashboard', route: '/portal/dashboard', parentId: null, order: 1, visibility: true, status: 'ACTIVE' as any, contractTypeVisibility: 'ALL', capability: 'dashboard.view' },
    { id: 'web3_org_profile', key: 'organization_profile', application: ApplicationContext.WEB_3, label: 'Organization Profile', type: 'PAGE' as any, icon: 'Building2', route: '/settings/organization', parentId: 'web3_group_organization', order: 2, visibility: true, status: 'ACTIVE' as any, contractTypeVisibility: 'ALL', capability: 'organization.view' },
    { id: 'web3_mng_projects', key: 'projects', application: ApplicationContext.WEB_3, label: 'Projects', type: 'PAGE' as any, icon: 'Briefcase', route: '/projects', parentId: 'web3_group_project_management', order: 3, visibility: true, status: 'ACTIVE' as any, contractTypeVisibility: 'WE_CONVERT_FOR_YOU', capability: 'project.view' },
    { id: 'web3_meetings', key: 'meeting_scheduler', application: ApplicationContext.WEB_3, label: 'Meeting Scheduler', type: 'PAGE' as any, icon: 'Calendar', route: '/meetings', parentId: 'web3_group_collaboration', order: 4, visibility: true, status: 'ACTIVE' as any, contractTypeVisibility: 'ALL', capability: 'meeting.view' },
    { id: 'web3_acc_profile', key: 'profile_security', application: ApplicationContext.WEB_3, label: 'Profile & Security', type: 'PAGE' as any, icon: 'User', route: '/account/profile', parentId: 'web3_group_account', order: 5, visibility: true, status: 'ACTIVE' as any, contractTypeVisibility: 'ALL', capability: 'account.manage' },
    { id: 'web3_billing_contracts', key: 'enterprise_contracts', application: ApplicationContext.WEB_3, label: 'Enterprise Contracts', type: 'PAGE' as any, icon: 'FileText', route: '/billing/contracts', parentId: 'web3_group_contract_billing', order: 6, visibility: true, status: 'ACTIVE' as any, contractTypeVisibility: 'ALL', capability: 'contract.view' },
    { id: 'web3_comm_conversations', key: 'web3.comm.conversations', application: ApplicationContext.WEB_3, label: 'Conversations', type: 'PAGE' as any, icon: 'MessageSquare', route: '/conversations', parentId: 'web3_group_communication', order: 8, visibility: true, status: 'ACTIVE' as any, contractTypeVisibility: 'WE_CONVERT_FOR_YOU', capability: 'conversations.view' },
    { id: 'web3_group_organization', key: 'organization', application: ApplicationContext.WEB_3, label: 'ORGANIZATION', type: 'GROUP' as any, icon: 'Folder', route: null, parentId: null, order: 9, visibility: true, status: 'ACTIVE' as any, contractTypeVisibility: 'ALL', capability: 'organization.view' },
    { id: 'web3_billing_invoices', key: 'invoices_payments', application: ApplicationContext.WEB_3, label: 'Invoices & Payments', type: 'PAGE' as any, icon: 'CreditCard', route: '/billing/invoices', parentId: 'web3_group_contract_billing', order: 10, visibility: true, status: 'ACTIVE' as any, contractTypeVisibility: 'ALL', capability: 'invoice.view' },
    { id: 'web3_acc_company', key: 'web3.account.company', application: ApplicationContext.WEB_3, label: 'Company Legal Profile', type: 'PAGE' as any, icon: 'Building', route: '/settings/organization', parentId: 'web3_group_account', order: 11, visibility: true, status: 'ACTIVE' as any, contractTypeVisibility: 'ALL', capability: 'organization.view' },
    { id: 'web3_comm_meetings', key: 'web3.comm.meetings', application: ApplicationContext.WEB_3, label: 'Meeting Requests', type: 'PAGE' as any, icon: 'CalendarDays', route: '/meetings', parentId: 'web3_group_communication', order: 12, visibility: true, status: 'ACTIVE' as any, contractTypeVisibility: 'ALL', capability: 'meeting.view' },
    { id: 'web3_mng_files', key: 'project_files', application: ApplicationContext.WEB_3, label: 'Project Files', type: 'PAGE' as any, icon: 'FolderGit2', route: '/project-files', parentId: 'web3_group_project_management', order: 14, visibility: true, status: 'ACTIVE' as any, contractTypeVisibility: 'WE_CONVERT_FOR_YOU', capability: 'project.files.view' },
    { id: 'web3_org_members', key: 'team_management', application: ApplicationContext.WEB_3, label: 'Team Management', type: 'PAGE' as any, icon: 'Users2', route: '/settings/team', parentId: 'web3_group_organization', order: 15, visibility: true, status: 'ACTIVE' as any, contractTypeVisibility: 'SELF_SERVICE', capability: 'organization.members.view' },
    { id: 'web3_org_teams', key: 'web3.org.teams', application: ApplicationContext.WEB_3, label: 'Internal Teams', type: 'PAGE' as any, icon: 'Shield', route: '/organization/teams', parentId: 'web3_group_organization', order: 18, visibility: true, status: 'ACTIVE' as any, contractTypeVisibility: 'SELF_SERVICE', capability: 'organization.teams.view' },
    { id: 'web3_group_contract_billing', key: 'contract_billing', application: ApplicationContext.WEB_3, label: 'CONTRACT & BILLING', type: 'GROUP' as any, icon: 'Folder', route: null, parentId: null, order: 19, visibility: true, status: 'ACTIVE' as any, contractTypeVisibility: 'ALL', capability: 'contract.view' },
    { id: 'web3_acc_preferences', key: 'web3.account.preferences', application: ApplicationContext.WEB_3, label: 'Preferences', type: 'PAGE' as any, icon: 'Sliders', route: '/account/preferences', parentId: 'web3_group_account', order: 20, visibility: true, status: 'ACTIVE' as any, contractTypeVisibility: 'ALL', capability: 'account.manage' },
    { id: 'web3_group_project_management', key: 'web3.group.project_management', application: ApplicationContext.WEB_3, label: 'PROJECT MANAGEMENT', type: 'GROUP' as any, icon: 'Folder', route: null, parentId: null, order: 21, visibility: true, status: 'ACTIVE' as any, contractTypeVisibility: 'WE_CONVERT_FOR_YOU', capability: 'project.view' },
    { id: 'web3_billing_usage', key: 'service_usage_quotas', application: ApplicationContext.WEB_3, label: 'Service Usage & Quotas', type: 'PAGE' as any, icon: 'Gauge', route: '/billing/usage', parentId: 'web3_group_contract_billing', order: 22, visibility: true, status: 'ACTIVE' as any, contractTypeVisibility: 'ALL', capability: 'service_usage.view' },
    { id: 'web3_mng_deliverables', key: 'web3.mng.deliverables', application: ApplicationContext.WEB_3, label: 'Conversion Deliverables', type: 'PAGE' as any, icon: 'PackageCheck', route: '/deliverables', parentId: 'web3_group_project_management', order: 25, visibility: true, status: 'ACTIVE' as any, contractTypeVisibility: 'WE_CONVERT_FOR_YOU', capability: 'deliverable.view' },
    { id: 'web3_group_communication', key: 'web3.group.communication', application: ApplicationContext.WEB_3, label: 'COMMUNICATION', type: 'GROUP' as any, icon: 'Folder', route: null, parentId: null, order: 26, visibility: true, status: 'ACTIVE' as any, contractTypeVisibility: 'WE_CONVERT_FOR_YOU', capability: 'conversations.view' },
    { id: 'web3_acc_password', key: 'web3.account.password', application: ApplicationContext.WEB_3, label: 'Change Password', type: 'PAGE' as any, icon: 'KeyRound', route: '/account/security/password', parentId: 'web3_group_account', order: 28, visibility: true, status: 'ACTIVE' as any, contractTypeVisibility: 'ALL', capability: 'account.security' },
    { id: 'web3_org_projects', key: 'web3.org.projects', application: ApplicationContext.WEB_3, label: 'Organization Projects', type: 'PAGE' as any, icon: 'Boxes', route: '/projects', parentId: 'web3_group_organization', order: 29, visibility: true, status: 'ACTIVE' as any, contractTypeVisibility: 'SELF_SERVICE', capability: 'project.view' },
    { id: 'web3_group_collaboration', key: 'collaboration', application: ApplicationContext.WEB_3, label: 'COLLABORATION', type: 'GROUP' as any, icon: 'Folder', route: null, parentId: null, order: 30, visibility: true, status: 'ACTIVE' as any, contractTypeVisibility: 'ALL', capability: 'meeting.view' },
    { id: 'web3_acc_2fa', key: 'web3.account.2fa', application: ApplicationContext.WEB_3, label: 'Two-Factor Authentication', type: 'PAGE' as any, icon: 'ShieldCheck', route: '/account/security/2fa', parentId: 'web3_group_account', order: 32, visibility: true, status: 'ACTIVE' as any, contractTypeVisibility: 'ALL', capability: 'account.security' },
    { id: 'web3_org_roles', key: 'web3.org.roles', application: ApplicationContext.WEB_3, label: 'Roles & Permissions', type: 'PAGE' as any, icon: 'Lock', route: '/settings/roles', parentId: 'web3_group_organization', order: 33, visibility: true, status: 'ACTIVE' as any, contractTypeVisibility: 'SELF_SERVICE', capability: 'organization.roles.manage' },
    { id: 'web3_group_account', key: 'account', application: ApplicationContext.WEB_3, label: 'ACCOUNT', type: 'GROUP' as any, icon: 'Folder', route: null, parentId: null, order: 34, visibility: true, status: 'ACTIVE' as any, contractTypeVisibility: 'ALL', capability: 'account.manage' },
    { id: 'web3_org_analytics', key: 'web3.org.analytics', application: ApplicationContext.WEB_3, label: 'Organization Analytics', type: 'PAGE' as any, icon: 'TrendingUp', route: '/organization/analytics', parentId: 'web3_group_organization', order: 36, visibility: true, status: 'ACTIVE' as any, contractTypeVisibility: 'SELF_SERVICE', capability: 'organization.analytics.view' },
    { id: 'web3_acc_sessions', key: 'web3.account.sessions', application: ApplicationContext.WEB_3, label: 'Active Sessions', type: 'PAGE' as any, icon: 'Laptop', route: '/account/security/sessions', parentId: 'web3_group_account', order: 37, visibility: true, status: 'ACTIVE' as any, contractTypeVisibility: 'ALL', capability: 'account.security' },
  ];

  beforeEach(() => {
    mockNavRepo = {
      findActiveVisibleMenuItems: jest.fn().mockResolvedValue(web3MenuItems),
      findMenuItemPermissionsByItemIds: jest.fn().mockResolvedValue(new Map()),
    };
    mockEffectivePerms = {
      getEffectivePermissions: jest.fn().mockResolvedValue([]),
      getUserRoles: jest.fn().mockResolvedValue([]),
    } as any;

    navigationService = new NavigationService(
      mockNavRepo,
      mockEffectivePerms,
      undefined,
      undefined,
    );
  });

  const flattenTree = (nodes: NavNode[]): NavNode[] => {
    const list: NavNode[] = [];
    for (const node of nodes) {
      list.push(node);
      if (node.children && node.children.length > 0) {
        list.push(...flattenTree(node.children));
      }
    }
    return list;
  };

  const ROLES = ['PARTNER', 'ORGANIZATION_OWNER', 'ADMIN', 'DEVELOPER', 'VIEWER'];
  const SERVICE_MODES: Array<'SELF_SERVICE' | 'WE_CONVERT_FOR_YOU'> = ['SELF_SERVICE', 'WE_CONVERT_FOR_YOU'];
  const CONTRACT_STATUSES: Array<'ACTIVE' | 'SUSPENDED' | 'EXPIRED'> = ['ACTIVE', 'SUSPENDED', 'EXPIRED'];

  // Test matrix: 5 roles x 2 serviceModes x 3 statuses = 30 combinations
  describe.each(ROLES)('Role: %s', (role) => {
    describe.each(SERVICE_MODES)('ServiceMode: %s', (serviceMode) => {
      describe.each(CONTRACT_STATUSES)('Status: %s', (contractStatus) => {
        it(`every visible WEB_3 menu item has a capability registered in VALID_CAPABILITY_KEYS`, async () => {
          const precomputedContext = {
            organizationId: 'org_test_123',
            organizationName: 'Matrix Test Org',
            serviceMode,
            contractStatus,
            contractNumber: 'CTR-MATRIX-TEST',
            role,
            permissions: [],
          };

          const navTree = await navigationService.getUserNavigation(
            'user_test_id',
            ApplicationContext.WEB_3,
            undefined,
            'test@example.com',
            precomputedContext,
          );

          expect(Array.isArray(navTree)).toBe(true);

          const allNodes = flattenTree(navTree);

          for (const node of allNodes) {
            // Ignore synthetic fallback if any
            if (node.id === 'default_dashboard') continue;

            // Step 5 assertion: capability must be defined and valid
            expect(node.capability).toBeDefined();
            expect(typeof node.capability).toBe('string');
            expect(node.capability!.length).toBeGreaterThan(0);

            const isRegistered = isValidCapability(node.capability!);
            if (!isRegistered) {
              throw new Error(
                `Menu item '${node.label}' (id: ${node.id}, key: ${node.key}) has UNREGISTERED capability: '${node.capability}'!`,
              );
            }
            expect(isRegistered).toBe(true);
          }
        });
      });
    });
  });

  it('web3_mng_deliverables has ACTIVE status, visibility true, and deliverable.view capability in Managed Mode', async () => {
    const precomputedContext = {
      organizationId: 'org_test_123',
      organizationName: 'Managed Test Org',
      serviceMode: 'WE_CONVERT_FOR_YOU' as const,
      contractStatus: 'ACTIVE' as const,
      contractNumber: 'CTR-MANAGED-001',
      role: 'PARTNER',
      permissions: [],
    };

    const navTree = await navigationService.getUserNavigation(
      'user_partner',
      ApplicationContext.WEB_3,
      undefined,
      'partner@example.com',
      precomputedContext,
    );

    const allNodes = flattenTree(navTree);
    const deliverables = allNodes.find((n) => n.id === 'web3_mng_deliverables');

    expect(deliverables).toBeDefined();
    expect(deliverables!.capability).toBe('deliverable.view');
    expect(deliverables!.visibility).toBe(true);
    expect(deliverables!.status).toBe('ACTIVE');
  });

  it('Self-Service mode excludes WE_CONVERT_FOR_YOU deliverables and managed project nodes', async () => {
    const precomputedContext = {
      organizationId: 'org_test_123',
      organizationName: 'Self-Service Test Org',
      serviceMode: 'SELF_SERVICE' as const,
      contractStatus: 'ACTIVE' as const,
      contractNumber: 'CTR-SELF-001',
      role: 'PARTNER',
      permissions: [],
    };

    const navTree = await navigationService.getUserNavigation(
      'user_partner',
      ApplicationContext.WEB_3,
      undefined,
      'partner@example.com',
      precomputedContext,
    );

    const allNodes = flattenTree(navTree);
    const deliverables = allNodes.find((n) => n.id === 'web3_mng_deliverables');
    expect(deliverables).toBeUndefined();
  });
});
