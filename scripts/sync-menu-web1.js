const mongoose = require('mongoose');
require('dotenv').config();

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const col = mongoose.connection.db.collection('menu_items');

  // 1. Root Dashboard
  await col.updateOne(
    { id: 'web1_dashboard' },
    { $set: { label: 'Dashboard', route: '/dashboard', visibility: true, status: 'ACTIVE', order: 1, parentId: null, contractTypeVisibility: 'ALL' } }
  );

  // 2. ORGANIZATION
  await col.updateOne({ id: 'web1_group_organization' }, { $set: { label: 'ORGANIZATION', visibility: true, status: 'ACTIVE', order: 2, contractTypeVisibility: 'ALL', parentId: null } });
  await col.updateOne({ id: 'web1_org_profile' }, { $set: { label: 'Organization Profile', visibility: true, status: 'ACTIVE', contractTypeVisibility: 'ALL', route: '/organization/profile', parentId: 'web1_group_organization', order: 1 } });
  
  // Upsert Team Management
  await col.updateOne(
    { id: 'web1_org_team' },
    { $set: { key: 'web1.org.team', application: 'WEB_1', label: 'Team Management', type: 'PAGE', icon: 'Users', visibility: true, status: 'ACTIVE', contractTypeVisibility: 'SELF_SERVICE', route: '/settings/team', parentId: 'web1_group_organization', order: 2 } },
    { upsert: true }
  );

  // Upsert Internal Teams
  await col.updateOne(
    { id: 'web1_org_teams' },
    { $set: { key: 'web1.org.teams', application: 'WEB_1', label: 'Internal Teams', type: 'PAGE', icon: 'Users', visibility: true, status: 'ACTIVE', contractTypeVisibility: 'ALL', route: '/organization/teams', parentId: 'web1_group_organization', order: 3 } },
    { upsert: true }
  );

  // Upsert Organization Projects
  await col.updateOne(
    { id: 'web1_org_projects' },
    { $set: { key: 'web1.org.projects', application: 'WEB_1', label: 'Organization Projects', type: 'PAGE', icon: 'Layers', visibility: true, status: 'ACTIVE', contractTypeVisibility: 'ALL', route: '/projects', parentId: 'web1_group_organization', order: 4 } },
    { upsert: true }
  );

  // Upsert Roles & Permissions
  await col.updateOne(
    { id: 'web1_org_roles' },
    { $set: { key: 'web1.org.roles', application: 'WEB_1', label: 'Roles & Permissions', type: 'PAGE', icon: 'Shield', visibility: true, status: 'ACTIVE', contractTypeVisibility: 'ALL', route: '/settings/roles', parentId: 'web1_group_organization', order: 5 } },
    { upsert: true }
  );

  // Upsert Organization Analytics
  await col.updateOne(
    { id: 'web1_org_analytics' },
    { $set: { key: 'web1.org.analytics', application: 'WEB_1', label: 'Organization Analytics', type: 'PAGE', icon: 'BarChart3', visibility: true, status: 'ACTIVE', contractTypeVisibility: 'ALL', route: '/organization/analytics', parentId: 'web1_group_organization', order: 6 } },
    { upsert: true }
  );

  // 3. CONTRACT & BILLING
  await col.updateOne({ id: 'web1_group_contract_billing' }, { $set: { label: 'CONTRACT & BILLING', visibility: true, status: 'ACTIVE', contractTypeVisibility: 'SELF_SERVICE', order: 3, parentId: null } });
  await col.updateOne({ id: 'web1_service_contract_subscription' }, { $set: { label: 'Enterprise Contracts', visibility: true, status: 'ACTIVE', contractTypeVisibility: 'SELF_SERVICE', parentId: 'web1_group_contract_billing', order: 1, route: '/contracts' } });
  await col.updateOne({ id: 'web1_invoices' }, { $set: { label: 'Invoices & Payments', visibility: true, status: 'ACTIVE', contractTypeVisibility: 'SELF_SERVICE', parentId: 'web1_group_contract_billing', order: 2, route: '/billing/invoices' } });
  await col.updateOne({ id: 'web1_service_usage' }, { $set: { label: 'Service Usage & Quotas', visibility: true, status: 'ACTIVE', contractTypeVisibility: 'SELF_SERVICE', parentId: 'web1_group_contract_billing', order: 3, route: '/billing/usage' } });

  // 4. COLLABORATION
  await col.updateOne({ id: 'web1_group_collaboration' }, { $set: { label: 'COLLABORATION', visibility: true, status: 'ACTIVE', contractTypeVisibility: 'ALL', order: 4, parentId: null } });
  await col.updateOne({ id: 'web1_meetings' }, { $set: { label: 'Meeting Scheduler', visibility: true, status: 'ACTIVE', contractTypeVisibility: 'ALL', parentId: 'web1_group_collaboration', order: 1, route: '/meetings' } });

  // 5. ACCOUNT
  await col.updateOne({ id: 'web1_group_account' }, { $set: { label: 'ACCOUNT', visibility: true, status: 'ACTIVE', contractTypeVisibility: 'ALL', order: 5, parentId: null } });
  await col.updateOne({ id: 'web1_account_profile' }, { $set: { label: 'Profile & Security', visibility: true, status: 'ACTIVE', parentId: 'web1_group_account', order: 1, route: '/account/profile' } });
  
  // Upsert Company Legal Profile
  await col.updateOne(
    { id: 'web1_account_company' },
    { $set: { key: 'web1.account.company', application: 'WEB_1', label: 'Company Legal Profile', type: 'PAGE', icon: 'Building2', visibility: true, status: 'ACTIVE', contractTypeVisibility: 'ALL', parentId: 'web1_group_account', order: 2, route: '/organization/profile' } },
    { upsert: true }
  );

  await col.updateOne({ id: 'web1_account_preferences' }, { $set: { label: 'Preferences', visibility: true, status: 'ACTIVE', parentId: 'web1_group_account', order: 3, route: '/account/preferences' } });
  await col.updateOne({ id: 'web1_security_password' }, { $set: { label: 'Change Password', visibility: true, status: 'ACTIVE', parentId: 'web1_group_account', order: 4, route: '/account/security/password' } });
  await col.updateOne({ id: 'web1_security_2fa' }, { $set: { label: 'Two-Factor Authentication', visibility: true, status: 'ACTIVE', parentId: 'web1_group_account', order: 5, route: '/account/security/2fa' } });
  await col.updateOne({ id: 'web1_security_sessions' }, { $set: { label: 'Active Sessions', visibility: true, status: 'ACTIVE', parentId: 'web1_group_account', order: 6, route: '/account/security/sessions' } });

  // 6. Deactivate legacy groups and items for WEB_1
  await col.updateMany(
    { id: { $in: [
      'web1_group_workspace', 'web1_projects',
      'web1_group_resources', 'web1_docs', 'web1_user_guide', 'web1_modernization_guide', 'web1_contact',
      'web1_group_service'
    ] } },
    { $set: { visibility: false, status: 'INACTIVE' } }
  );

  console.log('MongoDB menu_items for WEB_1 updated successfully!');
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
