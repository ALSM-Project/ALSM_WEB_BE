const mongoose = require('mongoose');
require('dotenv').config();
const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('MONGODB_URI must be configured in the environment or .env file');

async function seed() {
  await mongoose.connect(uri);
  const menuItemsColl = mongoose.connection.collection('menu_items');
  const permsColl = mongoose.connection.collection('menu_item_permissions');

  // 1. Delete legacy orphaned items
  await menuItemsColl.deleteOne({ id: 'item_fe273535' });
  await permsColl.deleteMany({ menuItemId: 'item_fe273535' });
  await menuItemsColl.deleteOne({ id: 'web2_team_performance' });
  await permsColl.deleteMany({ menuItemId: 'web2_team_performance' });
  console.log('Cleaned up legacy & duplicate items');

  // 2. Define authoritative items
  const items = [
    {
      id: 'web2_dashboard', key: 'dashboard', application: 'WEB_2',
      label: 'Dashboard', type: 'PAGE', icon: 'LayoutDashboard', route: '/',
      parentId: null, order: 1, visibility: true, status: 'ACTIVE', openInNewTab: false,
      permissions: []
    },
    {
      id: 'web2_group_conversions', key: 'group.conversions', application: 'WEB_2',
      label: 'Conversions', type: 'GROUP', icon: 'Cpu', route: null,
      parentId: null, order: 2, visibility: true, status: 'ACTIVE', openInNewTab: false,
      permissions: []
    },
    {
      id: 'web2_conversion_queue', key: 'conversions.queue', application: 'WEB_2',
      label: 'Conversion Queue', type: 'PAGE', icon: 'Cpu', route: '/queue',
      parentId: 'web2_group_conversions', order: 1, visibility: true, status: 'ACTIVE', openInNewTab: false,
      permissions: ['conversions.view']
    },
    {
      id: 'web2_quality_review', key: 'conversions.quality_review', application: 'WEB_2',
      label: 'Quality Review', type: 'PAGE', icon: 'ShieldCheck', route: '/review',
      parentId: 'web2_group_conversions', order: 2, visibility: true, status: 'ACTIVE', openInNewTab: false,
      permissions: ['quality-review.manage']
    },
    {
      id: 'web2_group_team_lead', key: 'group.team_lead', application: 'WEB_2',
      label: 'Team Lead', type: 'GROUP', icon: 'Workflow', route: null,
      parentId: null, order: 3, visibility: true, status: 'ACTIVE', openInNewTab: false,
      permissions: []
    },
    {
      id: 'web2_tl_workload', key: 'team_lead.workload', application: 'WEB_2',
      label: 'Team Workload & Progress', type: 'PAGE', icon: 'Activity', route: '/team-performance',
      parentId: 'web2_group_team_lead', order: 1, visibility: true, status: 'ACTIVE', openInNewTab: false,
      permissions: ['teams.manage']
    },
    {
      id: 'web2_tl_projects', key: 'team_lead.projects', application: 'WEB_2',
      label: 'Assigned Projects', type: 'PAGE', icon: 'FolderKanban', route: '/admin/projects',
      parentId: 'web2_group_team_lead', order: 2, visibility: true, status: 'ACTIVE', openInNewTab: false,
      permissions: ['teams.manage']
    },
    {
      id: 'web2_tl_members', key: 'team_lead.members', application: 'WEB_2',
      label: 'Team Members', type: 'PAGE', icon: 'Users', route: '/admin/users',
      parentId: 'web2_group_team_lead', order: 3, visibility: true, status: 'ACTIVE', openInNewTab: false,
      permissions: ['teams.manage', 'users.manage']
    },
    {
      id: 'web2_tl_temporary_roles', key: 'team_lead.temporary_roles', application: 'WEB_2',
      label: 'Temporary Roles', type: 'PAGE', icon: 'Shield', route: '/admin/temporary-roles',
      parentId: 'web2_group_team_lead', order: 4, visibility: true, status: 'ACTIVE', openInNewTab: false,
      permissions: ['teams.manage', 'roles.temporary.manage']
    },
    {
      id: 'web2_tl_meetings', key: 'team_lead.meetings', application: 'WEB_2',
      label: 'Online Meetings', type: 'PAGE', icon: 'Video', route: '/enterprise/meetings',
      parentId: 'web2_group_team_lead', order: 5, visibility: true, status: 'ACTIVE', openInNewTab: false,
      permissions: ['teams.manage', 'meetings.view']
    },
    {
      id: 'web2_group_commercial', key: 'group.commercial', application: 'WEB_2',
      label: 'CRM & Sales', type: 'GROUP', icon: 'Zap', route: null,
      parentId: null, order: 4, visibility: true, status: 'ACTIVE', openInNewTab: false,
      permissions: []
    },
    {
      id: 'web2_leads', key: 'commercial.leads', application: 'WEB_2',
      label: 'Leads (CRM)', type: 'PAGE', icon: 'Users', route: '/sales/leads',
      parentId: 'web2_group_commercial', order: 1, visibility: true, status: 'ACTIVE', openInNewTab: false,
      permissions: ['sales.leads.view']
    },
    {
      id: 'web2_pipeline', key: 'commercial.pipeline', application: 'WEB_2',
      label: 'Sales Pipeline', type: 'PAGE', icon: 'FolderKanban', route: '/sales/pipeline',
      parentId: 'web2_group_commercial', order: 2, visibility: true, status: 'ACTIVE', openInNewTab: false,
      permissions: ['sales.leads.view']
    },
    {
      id: 'web2_sales_reports', key: 'commercial.reports', application: 'WEB_2',
      label: 'Sales Reports', type: 'PAGE', icon: 'BarChart3', route: '/sales/reports',
      parentId: 'web2_group_commercial', order: 3, visibility: true, status: 'ACTIVE', openInNewTab: false,
      permissions: ['sales.reports.view']
    },
    {
      id: 'web2_discounts', key: 'commercial.discounts', application: 'WEB_2',
      label: 'Discount Approvals', type: 'PAGE', icon: 'FileCheck', route: '/sales/discounts',
      parentId: 'web2_group_commercial', order: 4, visibility: true, status: 'ACTIVE', openInNewTab: false,
      permissions: ['sales.discounts.approve']
    },
    {
      id: 'web2_enterprise_quotes', key: 'commercial.quotes', application: 'WEB_2',
      label: 'Enterprise Quotes', type: 'PAGE', icon: 'Zap', route: '/admin/billing/quotes',
      parentId: 'web2_group_commercial', order: 5, visibility: true, status: 'ACTIVE', openInNewTab: false,
      permissions: ['billing.quotes.manage']
    },
    {
      id: 'web2_service_usage', key: 'commercial.usage', application: 'WEB_2',
      label: 'Service Usage', type: 'PAGE', icon: 'CreditCard', route: '/admin/billing/usage',
      parentId: 'web2_group_commercial', order: 6, visibility: true, status: 'ACTIVE', openInNewTab: false,
      permissions: ['billing.usage.view']
    },
    {
      id: 'web2_group_operations', key: 'group.operations', application: 'WEB_2',
      label: 'Operations', type: 'GROUP', icon: 'Users', route: null,
      parentId: null, order: 5, visibility: true, status: 'ACTIVE', openInNewTab: false,
      permissions: []
    },
    {
      id: 'web2_online_meetings', key: 'operations.meetings', application: 'WEB_2',
      label: 'Online Meeting', type: 'PAGE', icon: 'Video', route: '/enterprise/meetings',
      parentId: 'web2_group_operations', order: 1, visibility: true, status: 'ACTIVE', openInNewTab: false,
      permissions: ['meetings.view']
    },
    {
      id: 'web2_group_administration', key: 'group.administration', application: 'WEB_2',
      label: 'Administration', type: 'GROUP', icon: 'Settings2', route: null,
      parentId: null, order: 6, visibility: true, status: 'ACTIVE', openInNewTab: false,
      permissions: []
    },
    {
      id: 'web2_organizations', key: 'admin.organizations', application: 'WEB_2',
      label: 'Organisations', type: 'PAGE', icon: 'Globe', route: '/admin/organizations',
      parentId: 'web2_group_administration', order: 1, visibility: true, status: 'ACTIVE', openInNewTab: false,
      permissions: ['organizations.view']
    },
    {
      id: 'web2_admin_projects', key: 'admin.projects', application: 'WEB_2',
      label: 'Admin Projects', type: 'PAGE', icon: 'FolderKanban', route: '/admin/projects',
      parentId: 'web2_group_administration', order: 2, visibility: true, status: 'ACTIVE', openInNewTab: false,
      permissions: ['organizations.manage']
    },
    {
      id: 'web2_engagement_types', key: 'admin.engagement_types', application: 'WEB_2',
      label: 'Engagement Types', type: 'PAGE', icon: 'Layers', route: '/admin/engagement-types',
      parentId: 'web2_group_administration', order: 3, visibility: true, status: 'ACTIVE', openInNewTab: false,
      permissions: ['organizations.manage']
    },
    {
      id: 'web2_menu_builder', key: 'admin.menu_builder', application: 'WEB_2',
      label: 'Menu Builder', type: 'PAGE', icon: 'ListTree', route: '/admin/menu-builder',
      parentId: 'web2_group_administration', order: 4, visibility: true, status: 'ACTIVE', openInNewTab: false,
      permissions: ['menu.manage']
    },
    {
      id: 'web2_roles', key: 'admin.roles', application: 'WEB_2',
      label: 'Roles & Permissions', type: 'PAGE', icon: 'Shield', route: '/admin/roles',
      parentId: 'web2_group_administration', order: 5, visibility: true, status: 'ACTIVE', openInNewTab: false,
      permissions: ['roles.manage']
    },
    {
      id: 'web2_users', key: 'admin.users', application: 'WEB_2',
      label: 'User Accounts', type: 'PAGE', icon: 'Users', route: '/admin/users',
      parentId: 'web2_group_administration', order: 6, visibility: true, status: 'ACTIVE', openInNewTab: false,
      permissions: ['users.manage']
    },
    {
      id: 'web2_temporary_roles', key: 'admin.temporary_roles', application: 'WEB_2',
      label: 'Temporary Roles', type: 'PAGE', icon: 'Shield', route: '/admin/temporary-roles',
      parentId: 'web2_group_administration', order: 7, visibility: true, status: 'ACTIVE', openInNewTab: false,
      permissions: ['roles.temporary.manage']
    },
    {
      id: 'web2_revenue', key: 'admin.revenue', application: 'WEB_2',
      label: 'Revenue Dashboard', type: 'PAGE', icon: 'CreditCard', route: '/admin/revenue',
      parentId: 'web2_group_administration', order: 8, visibility: true, status: 'ACTIVE', openInNewTab: false,
      permissions: ['revenue.view']
    },
    {
      id: 'web2_audit_logs', key: 'admin.audit_logs', application: 'WEB_2',
      label: 'Audit Logs', type: 'PAGE', icon: 'Activity', route: '/admin/audit-logs',
      parentId: 'web2_group_administration', order: 9, visibility: true, status: 'ACTIVE', openInNewTab: false,
      permissions: ['audit.view']
    }
  ];

  for (const item of items) {
    const existing = await menuItemsColl.findOne({ key: item.key, application: item.application });
    const doc = {
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
      updatedAt: new Date(),
    };
    if (!existing) {
      doc.createdAt = new Date();
      await menuItemsColl.insertOne(doc);
      console.log('Inserted:', item.key);
    } else {
      await menuItemsColl.updateOne({ _id: existing._id }, { $set: doc });
      console.log('Updated:', item.key);
    }

    // sync permissions
    await permsColl.deleteMany({ menuItemId: item.id });
    if (item.permissions.length > 0) {
      await permsColl.insertMany(item.permissions.map(p => ({
        menuItemId: item.id,
        permissionKey: p,
        createdAt: new Date(),
        updatedAt: new Date()
      })));
    }
  }

  console.log('\nMenu items seed finished successfully!');
  await mongoose.disconnect();
}
seed();
