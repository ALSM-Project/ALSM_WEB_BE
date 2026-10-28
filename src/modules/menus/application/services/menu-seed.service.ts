import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ApplicationContext, MenuItemStatus, MenuItemType } from '../../domain/enums/menu.enums';
import {
  IMenuBuilderRepository,
  MENU_BUILDER_REPOSITORY,
} from '../../domain/interfaces/menu-builder.repository.interface';

interface DefaultMenuItemSeed {
  id: string;
  key: string;
  application: ApplicationContext;
  label: string;
  type: MenuItemType;
  icon: string;
  route: string | null;
  parentId: string | null;
  order: number;
  visibility: boolean;
  status: MenuItemStatus;
  openInNewTab: boolean;
  permissions: string[];
}

import { runStartupSeed } from '../../../../shared/startup/run-startup-seed';

@Injectable()
export class MenuSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MenuSeedService.name);

  constructor(
    @Inject(MENU_BUILDER_REPOSITORY)
    private readonly menuBuilderRepo: IMenuBuilderRepository,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await runStartupSeed(this.logger, 'Menu', async () => {
      await this.cleanupLegacyOrphanedItems();
      await this.seedWeb2DefaultMenus();
      await this.seedWeb3DefaultMenus();
    });
  }

  private async cleanupLegacyOrphanedItems(): Promise<void> {
    try {
      // Clean up legacy placeholder item created outside the menu builder system
      const legacy = await this.menuBuilderRepo.findMenuItemById('item_fe273535');
      if (legacy) {
        await this.menuBuilderRepo.deleteMenuItem('item_fe273535');
        this.logger.log('Removed legacy orphaned menu item: item_fe273535');
      }
      const duplicatePerf = await this.menuBuilderRepo.findMenuItemById('web2_team_performance');
      if (duplicatePerf) {
        await this.menuBuilderRepo.deleteMenuItem('web2_team_performance');
        this.logger.log('Removed duplicate web2_team_performance from Operations');
      }

      // Clean up legacy sidebar action items
      const legacyCreateProject = await this.menuBuilderRepo.findMenuItemById('web2_partner_project_create');
      if (legacyCreateProject) {
        await this.menuBuilderRepo.deleteMenuItem('web2_partner_project_create');
        this.logger.log('Removed web2_partner_project_create action from sidebar navigation');
      }
      const legacyProjectList = await this.menuBuilderRepo.findMenuItemById('web2_partner_project_list');
      if (legacyProjectList) {
        await this.menuBuilderRepo.deleteMenuItem('web2_partner_project_list');
        this.logger.log('Removed web2_partner_project_list from sidebar navigation');
      }
      const legacyProjectGroup = await this.menuBuilderRepo.findMenuItemById('web2_group_partner_projects');
      if (legacyProjectGroup) {
        await this.menuBuilderRepo.deleteMenuItem('web2_group_partner_projects');
        this.logger.log('Removed web2_group_partner_projects from sidebar navigation');
      }
      const legacyPartnerCreate = await this.menuBuilderRepo.findMenuItemById('web2_partner_create');
      if (legacyPartnerCreate) {
        await this.menuBuilderRepo.deleteMenuItem('web2_partner_create');
        this.logger.log('Removed web2_partner_create action from sidebar navigation');
      }
    } catch {
      // Ignore if not found
    }
  }

  private async seedWeb2DefaultMenus(): Promise<void> {
    const defaultWeb2Items: DefaultMenuItemSeed[] = [
      // 1. Dashboard (Root page, accessible to all authenticated staff)
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
        openInNewTab: false,
        permissions: [],
      },

      // 2. Conversions (Group: Quality Reviews & Conversions)
      {
        id: 'web2_group_conversions',
        key: 'group.conversions',
        application: ApplicationContext.WEB_2,
        label: 'Conversions',
        type: MenuItemType.GROUP,
        icon: 'Cpu',
        route: null,
        parentId: null,
        order: 2,
        visibility: true,
        status: MenuItemStatus.ACTIVE,
        openInNewTab: false,
        permissions: [],
      },
      {
        id: 'web2_my_assigned_work',
        key: 'conversions.my_work',
        application: ApplicationContext.WEB_2,
        label: 'My Assigned Work',
        type: MenuItemType.PAGE,
        icon: 'Briefcase',
        route: '/my-work',
        parentId: 'web2_group_conversions',
        order: 1,
        visibility: true,
        status: MenuItemStatus.ACTIVE,
        openInNewTab: false,
        permissions: ['conversions.view'],
      },
      {
        id: 'web2_quality_review',
        key: 'conversions.quality_review',
        application: ApplicationContext.WEB_2,
        label: 'Quality Review',
        type: MenuItemType.PAGE,
        icon: 'ShieldCheck',
        route: '/review',
        parentId: 'web2_group_conversions',
        order: 2,
        visibility: true,
        status: MenuItemStatus.ACTIVE,
        openInNewTab: false,
        permissions: ['quality-review.manage'],
      },

      // 3. Team Lead Workspace (Group: Team Workload, Projects, Staff & Temporary Roles)
      {
        id: 'web2_group_team_lead',
        key: 'group.team_lead',
        application: ApplicationContext.WEB_2,
        label: 'Team Lead',
        type: MenuItemType.GROUP,
        icon: 'Workflow',
        route: null,
        parentId: null,
        order: 3,
        visibility: true,
        status: MenuItemStatus.ACTIVE,
        openInNewTab: false,
        permissions: [],
      },
      {
        id: 'web2_tl_workload',
        key: 'team_lead.workload',
        application: ApplicationContext.WEB_2,
        label: 'Team Workload & Progress',
        type: MenuItemType.PAGE,
        icon: 'Activity',
        route: '/team-performance',
        parentId: 'web2_group_team_lead',
        order: 1,
        visibility: true,
        status: MenuItemStatus.ACTIVE,
        openInNewTab: false,
        permissions: ['teams.manage'],
      },
      {
        id: 'web2_tl_projects',
        key: 'team_lead.projects',
        application: ApplicationContext.WEB_2,
        label: 'Employee Allocation',
        type: MenuItemType.PAGE,
        icon: 'Users',
        route: '/team-lead/projects',
        parentId: 'web2_group_team_lead',
        order: 2,
        visibility: true,
        status: MenuItemStatus.ACTIVE,
        openInNewTab: false,
        permissions: ['teams.manage'],
      },
      {
        id: 'web2_tl_members',
        key: 'team_lead.members',
        application: ApplicationContext.WEB_2,
        label: 'Team Members',
        type: MenuItemType.PAGE,
        icon: 'Users',
        route: '/admin/users',
        parentId: 'web2_group_team_lead',
        order: 3,
        visibility: true,
        status: MenuItemStatus.ACTIVE,
        openInNewTab: false,
        permissions: ['teams.manage', 'users.view', 'users.manage'],
      },
      {
        id: 'web2_tl_temporary_roles',
        key: 'team_lead.temporary_roles',
        application: ApplicationContext.WEB_2,
        label: 'Temporary Roles',
        type: MenuItemType.PAGE,
        icon: 'Shield',
        route: '/admin/temporary-roles',
        parentId: 'web2_group_team_lead',
        order: 4,
        visibility: true,
        status: MenuItemStatus.ACTIVE,
        openInNewTab: false,
        permissions: ['roles.temporary.view', 'roles.temporary.manage', 'roles.temporary.request', 'teams.manage'],
      },
      {
        id: 'web2_tl_meetings',
        key: 'team_lead.meetings',
        application: ApplicationContext.WEB_2,
        label: 'Online Meetings',
        type: MenuItemType.PAGE,
        icon: 'Video',
        route: '/enterprise/meetings',
        parentId: 'web2_group_team_lead',
        order: 5,
        visibility: true,
        status: MenuItemStatus.ACTIVE,
        openInNewTab: false,
        permissions: ['meetings.view', 'meetings.create', 'teams.manage'],
      },

      // 4. CRM & Sales (Group: Leads, Pipeline, Reports, Discounts, Quotes, Usage)
      {
        id: 'web2_group_commercial',
        key: 'group.commercial',
        application: ApplicationContext.WEB_2,
        label: 'CRM & Sales',
        type: MenuItemType.GROUP,
        icon: 'Zap',
        route: null,
        parentId: null,
        order: 4,
        visibility: true,
        status: MenuItemStatus.ACTIVE,
        openInNewTab: false,
        permissions: [],
      },
      {
        id: 'web2_leads',
        key: 'commercial.leads',
        application: ApplicationContext.WEB_2,
        label: 'Leads (CRM)',
        type: MenuItemType.PAGE,
        icon: 'Users',
        route: '/sales/leads',
        parentId: 'web2_group_commercial',
        order: 1,
        visibility: true,
        status: MenuItemStatus.ACTIVE,
        openInNewTab: false,
        permissions: ['sales.leads.view'],
      },
      {
        id: 'web2_pipeline',
        key: 'commercial.pipeline',
        application: ApplicationContext.WEB_2,
        label: 'Sales Pipeline',
        type: MenuItemType.PAGE,
        icon: 'FolderKanban',
        route: '/sales/pipeline',
        parentId: 'web2_group_commercial',
        order: 2,
        visibility: true,
        status: MenuItemStatus.ACTIVE,
        openInNewTab: false,
        permissions: ['sales.leads.view'],
      },
      {
        id: 'web2_sales_reports',
        key: 'commercial.reports',
        application: ApplicationContext.WEB_2,
        label: 'Sales Reports',
        type: MenuItemType.PAGE,
        icon: 'BarChart3',
        route: '/sales/reports',
        parentId: 'web2_group_commercial',
        order: 3,
        visibility: true,
        status: MenuItemStatus.ACTIVE,
        openInNewTab: false,
        permissions: ['sales.reports.view'],
      },
      {
        id: 'web2_sales_team_perf',
        key: 'commercial.team_perf',
        application: ApplicationContext.WEB_2,
        label: 'Team Performance',
        type: MenuItemType.PAGE,
        icon: 'TrendingUp',
        route: '/reports/team-performance',
        parentId: 'web2_group_commercial',
        order: 4,
        visibility: true,
        status: MenuItemStatus.ACTIVE,
        openInNewTab: false,
        permissions: ['sales.team-performance.view'],
      },
      {
        id: 'web2_discounts',
        key: 'commercial.discounts',
        application: ApplicationContext.WEB_2,
        label: 'Discount Approvals',
        type: MenuItemType.PAGE,
        icon: 'FileCheck',
        route: '/sales/discounts',
        parentId: 'web2_group_commercial',
        order: 5,
        visibility: true,
        status: MenuItemStatus.ACTIVE,
        openInNewTab: false,
        permissions: ['sales.discounts.view'],
      },
      {
        id: 'web2_enterprise_quotes',
        key: 'commercial.quotes',
        application: ApplicationContext.WEB_2,
        label: 'Enterprise Quotes',
        type: MenuItemType.PAGE,
        icon: 'Zap',
        route: '/admin/billing/quotes',
        parentId: 'web2_group_commercial',
        order: 6,
        visibility: true,
        status: MenuItemStatus.ACTIVE,
        openInNewTab: false,
        permissions: ['billing.quotes.manage'],
      },
      {
        id: 'web2_service_usage',
        key: 'commercial.usage',
        application: ApplicationContext.WEB_2,
        label: 'Service Usage',
        type: MenuItemType.PAGE,
        icon: 'CreditCard',
        route: '/admin/billing/usage',
        parentId: 'web2_group_commercial',
        order: 7,
        visibility: true,
        status: MenuItemStatus.ACTIVE,
        openInNewTab: false,
        permissions: ['billing.usage.view'],
      },

      // 5. Operations (General Online Meetings and Conversion Queue for authorized staff)
      {
        id: 'web2_group_operations',
        key: 'group.operations',
        application: ApplicationContext.WEB_2,
        label: 'Operations',
        type: MenuItemType.GROUP,
        icon: 'Cpu',
        route: null,
        parentId: null,
        order: 5,
        visibility: true,
        status: MenuItemStatus.ACTIVE,
        openInNewTab: false,
        permissions: [],
      },
      {
        id: 'web2_conversion_queue',
        key: 'operations.queue',
        application: ApplicationContext.WEB_2,
        label: 'Conversion Queue',
        type: MenuItemType.PAGE,
        icon: 'Cpu',
        route: '/queue',
        parentId: 'web2_group_operations',
        order: 1,
        visibility: true,
        status: MenuItemStatus.ACTIVE,
        openInNewTab: false,
        permissions: ['conversions.queue.view'],
      },
      {
        id: 'web2_online_meetings',
        key: 'operations.meetings',
        application: ApplicationContext.WEB_2,
        label: 'Online Meeting',
        type: MenuItemType.PAGE,
        icon: 'Video',
        route: '/enterprise/meetings',
        parentId: 'web2_group_operations',
        order: 2,
        visibility: true,
        status: MenuItemStatus.ACTIVE,
        openInNewTab: false,
        permissions: ['meetings.view'],
      },

      // 5.5 Customer Support (Organisation Access & Troubleshooting)
      {
        id: 'web2_group_support',
        key: 'group.support',
        application: ApplicationContext.WEB_2,
        label: 'Customer Support',
        type: MenuItemType.GROUP,
        icon: 'Headphones',
        route: null,
        parentId: null,
        order: 5.5,
        visibility: true,
        status: MenuItemStatus.ACTIVE,
        openInNewTab: false,
        permissions: [],
      },
      {
        id: 'web2_support_org_access',
        key: 'support.org_access',
        application: ApplicationContext.WEB_2,
        label: 'Organisation Access',
        type: MenuItemType.PAGE,
        icon: 'Building2',
        route: '/admin/organizations',
        parentId: 'web2_group_support',
        order: 1,
        visibility: true,
        status: MenuItemStatus.ACTIVE,
        openInNewTab: false,
        permissions: ['organizations.impersonate'],
      },
      {
        id: 'web2_support_troubleshooting',
        key: 'support.troubleshooting',
        application: ApplicationContext.WEB_2,
        label: 'Conversion Support',
        type: MenuItemType.PAGE,
        icon: 'Wrench',
        route: '/queue?tab=troubleshoot',
        parentId: 'web2_group_support',
        order: 2,
        visibility: true,
        status: MenuItemStatus.ACTIVE,
        openInNewTab: false,
        permissions: ['conversions.troubleshoot.view'],
      },

      // 6. Platform Administration (Comprehensive Admin Control)
      {
        id: 'web2_group_administration',
        key: 'group.administration',
        application: ApplicationContext.WEB_2,
        label: 'Administration',
        type: MenuItemType.GROUP,
        icon: 'Settings2',
        route: null,
        parentId: null,
        order: 6,
        visibility: true,
        status: MenuItemStatus.ACTIVE,
        openInNewTab: false,
        permissions: [],
      },
      {
        id: 'web2_organizations',
        key: 'admin.organizations',
        application: ApplicationContext.WEB_2,
        label: 'Organisations',
        type: MenuItemType.PAGE,
        icon: 'Globe',
        route: '/admin/organizations',
        parentId: 'web2_group_administration',
        order: 1,
        visibility: true,
        status: MenuItemStatus.ACTIVE,
        openInNewTab: false,
        permissions: ['organizations.view'],
      },
      {
        id: 'web2_admin_projects',
        key: 'admin.projects',
        application: ApplicationContext.WEB_2,
        label: 'Team Lead Assignment',
        type: MenuItemType.PAGE,
        icon: 'FolderKanban',
        route: '/admin/projects',
        parentId: 'web2_group_administration',
        order: 2,
        visibility: true,
        status: MenuItemStatus.ACTIVE,
        openInNewTab: false,
        permissions: ['organizations.manage'],
      },
      {
        id: 'web2_engagement_types',
        key: 'admin.engagement_types',
        application: ApplicationContext.WEB_2,
        label: 'Engagement Types',
        type: MenuItemType.PAGE,
        icon: 'Layers',
        route: '/admin/engagement-types',
        parentId: 'web2_group_administration',
        order: 3,
        visibility: true,
        status: MenuItemStatus.ACTIVE,
        openInNewTab: false,
        permissions: ['organizations.manage'],
      },
      {
        id: 'web2_menu_builder',
        key: 'admin.menu_builder',
        application: ApplicationContext.WEB_2,
        label: 'Menu Builder',
        type: MenuItemType.PAGE,
        icon: 'ListTree',
        route: '/admin/menu-builder',
        parentId: 'web2_group_administration',
        order: 4,
        visibility: true,
        status: MenuItemStatus.ACTIVE,
        openInNewTab: false,
        permissions: ['menu.manage'],
      },
      {
        id: 'web2_roles',
        key: 'admin.roles',
        application: ApplicationContext.WEB_2,
        label: 'Roles & Permissions',
        type: MenuItemType.PAGE,
        icon: 'Shield',
        route: '/admin/roles',
        parentId: 'web2_group_administration',
        order: 5,
        visibility: true,
        status: MenuItemStatus.ACTIVE,
        openInNewTab: false,
        permissions: ['roles.manage'],
      },
      {
        id: 'web2_users',
        key: 'admin.users',
        application: ApplicationContext.WEB_2,
        label: 'User Accounts',
        type: MenuItemType.PAGE,
        icon: 'Users',
        route: '/admin/users',
        parentId: 'web2_group_administration',
        order: 6,
        visibility: true,
        status: MenuItemStatus.ACTIVE,
        openInNewTab: false,
        permissions: ['users.manage'],
      },
      {
        id: 'web2_temporary_roles',
        key: 'admin.temporary_roles',
        application: ApplicationContext.WEB_2,
        label: 'Temporary Roles',
        type: MenuItemType.PAGE,
        icon: 'Shield',
        route: '/admin/temporary-roles',
        parentId: 'web2_group_administration',
        order: 7,
        visibility: true,
        status: MenuItemStatus.ACTIVE,
        openInNewTab: false,
        permissions: ['roles.temporary.manage'],
      },
      {
        id: 'web2_revenue',
        key: 'admin.revenue',
        application: ApplicationContext.WEB_2,
        label: 'Revenue Dashboard',
        type: MenuItemType.PAGE,
        icon: 'CreditCard',
        route: '/admin/revenue',
        parentId: 'web2_group_administration',
        order: 8,
        visibility: true,
        status: MenuItemStatus.ACTIVE,
        openInNewTab: false,
        permissions: ['revenue.view'],
      },
      {
        id: 'web2_audit_logs',
        key: 'admin.audit_logs',
        application: ApplicationContext.WEB_2,
        label: 'Audit Logs',
        type: MenuItemType.PAGE,
        icon: 'Activity',
        route: '/admin/audit-logs',
        parentId: 'web2_group_administration',
        order: 9,
        visibility: true,
        status: MenuItemStatus.ACTIVE,
        openInNewTab: false,
        permissions: ['audit.view'],
      },

      // 7. Partner Management (Group: Partner List & Onboarding)
      {
        id: 'web2_group_partners',
        key: 'group.partners',
        application: ApplicationContext.WEB_2,
        label: 'Partner Management',
        type: MenuItemType.GROUP,
        icon: 'Building2',
        route: null,
        parentId: null,
        order: 7,
        visibility: true,
        status: MenuItemStatus.ACTIVE,
        openInNewTab: false,
        permissions: [],
      },
      {
        id: 'web2_partner_list',
        key: 'partner.list',
        application: ApplicationContext.WEB_2,
        label: 'Partner Directory',
        type: MenuItemType.PAGE,
        icon: 'Building2',
        route: '/partners',
        parentId: 'web2_group_partners',
        order: 1,
        visibility: true,
        status: MenuItemStatus.ACTIVE,
        openInNewTab: false,
        permissions: ['partner.view'],
      },
      {
        id: 'web2_partner_projects',
        key: 'partner.projects',
        application: ApplicationContext.WEB_2,
        label: 'Partner Projects',
        type: MenuItemType.PAGE,
        icon: 'FolderKanban',
        route: '/partners/projects',
        parentId: 'web2_group_partners',
        order: 2,
        visibility: true,
        status: MenuItemStatus.ACTIVE,
        openInNewTab: false,
        permissions: ['partner.view'],
      },
      {
        id: 'web2_demo_projects',
        key: 'projects.demo',
        application: ApplicationContext.WEB_2,
        label: 'Demo Projects',
        type: MenuItemType.PAGE,
        icon: 'Sparkles',
        route: '/partners/projects?scope=demo',
        parentId: 'web2_group_partners',
        order: 3,
        visibility: true,
        status: MenuItemStatus.ACTIVE,
        openInNewTab: false,
        permissions: ['projects.demo.view'],
      },
    ];

    for (const item of defaultWeb2Items) {
      const existingByKey = await this.menuBuilderRepo.findMenuItemByKey(item.key, item.application);
      if (existingByKey && existingByKey.id !== item.id) {
        await this.menuBuilderRepo.deleteMenuItem(existingByKey.id);
      }

      const existing = await this.menuBuilderRepo.findMenuItemById(item.id);
      if (!existing) {
        await this.menuBuilderRepo.createMenuItem(
          {
            id: item.id,
            key: item.key,
            application: item.application,
            label: item.label,
            type: item.type,
            icon: item.icon,
            route: item.route,
            parentId: item.parentId,
            order: item.order,
            visibility: item.visibility,
            status: item.status,
            openInNewTab: item.openInNewTab,
          },
          item.permissions,
        );
        this.logger.log(`Seeded default Web 2 menu item: ${item.key}`);
      } else {
        await this.menuBuilderRepo.updateMenuItem(
          item.id,
          {
            key: item.key,
            label: item.label,
            route: item.route,
            parentId: item.parentId,
            order: item.order,
            icon: item.icon,
            visibility: item.visibility,
            status: item.status,
          },
          item.permissions,
        );
      }
    }
  }

  private async seedWeb3DefaultMenus(): Promise<void> {
    const defaultWeb3Items: DefaultMenuItemSeed[] = [
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
        openInNewTab: false,
        permissions: ['partner_portal.dashboard.view'],
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
        openInNewTab: false,
        permissions: ['partner_portal.project.view'],
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
        openInNewTab: false,
        permissions: ['partner_portal.download'],
      },
    ];

    for (const item of defaultWeb3Items) {
      const existingByKey = await this.menuBuilderRepo.findMenuItemByKey(item.key, item.application);
      if (existingByKey && existingByKey.id !== item.id) {
        await this.menuBuilderRepo.deleteMenuItem(existingByKey.id);
      }

      const existing = await this.menuBuilderRepo.findMenuItemById(item.id);
      if (!existing) {
        await this.menuBuilderRepo.createMenuItem(
          {
            id: item.id,
            key: item.key,
            application: item.application,
            label: item.label,
            type: item.type,
            icon: item.icon,
            route: item.route,
            parentId: item.parentId,
            order: item.order,
            visibility: item.visibility,
            status: item.status,
            openInNewTab: item.openInNewTab,
          },
          item.permissions,
        );
        this.logger.log(`Seeded default Web 3 menu item: ${item.key}`);
      } else {
        await this.menuBuilderRepo.updateMenuItem(
          item.id,
          {
            key: item.key,
            label: item.label,
            route: item.route,
            parentId: item.parentId,
            order: item.order,
            icon: item.icon,
            visibility: item.visibility,
            status: item.status,
          },
          item.permissions,
        );
      }
    }
  }
}
