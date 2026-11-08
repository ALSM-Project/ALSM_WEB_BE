const mongoose = require('mongoose');
require('dotenv').config();

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const col = mongoose.connection.db.collection('menu_items');

  // 1. Root Dashboard
  await col.updateOne(
    { id: 'web3_dashboard' },
    { $set: { label: 'Dashboard', route: '/dashboard', visibility: true, status: 'ACTIVE', order: 1, contractTypeVisibility: 'ALL' } }
  );

  // 2. Activate Organization items
  await col.updateOne({ id: 'web3_group_organization' }, { $set: { label: 'ORGANIZATION', visibility: true, status: 'ACTIVE', order: 2, contractTypeVisibility: 'ALL' } });
  await col.updateOne({ id: 'web3_org_profile' }, { $set: { label: 'Organization Profile', visibility: true, status: 'ACTIVE', contractTypeVisibility: 'ALL', route: '/settings/organization', order: 1 } });
  await col.updateOne({ id: 'web3_org_members' }, { $set: { label: 'Team Management', visibility: true, status: 'ACTIVE', contractTypeVisibility: 'SELF_SERVICE', route: '/settings/team', order: 2 } });
  await col.updateOne({ id: 'web3_org_teams' }, { $set: { label: 'Internal Teams', visibility: true, status: 'ACTIVE', contractTypeVisibility: 'ALL', route: '/organization/teams', order: 3 } });
  await col.updateOne({ id: 'web3_org_projects' }, { $set: { label: 'Organization Projects', visibility: true, status: 'ACTIVE', contractTypeVisibility: 'ALL', route: '/projects', order: 4 } });
  await col.updateOne({ id: 'web3_org_roles' }, { $set: { label: 'Roles & Permissions', visibility: true, status: 'ACTIVE', contractTypeVisibility: 'ALL', route: '/settings/roles', order: 5 } });
  await col.updateOne({ id: 'web3_org_analytics' }, { $set: { label: 'Organization Analytics', visibility: true, status: 'ACTIVE', contractTypeVisibility: 'ALL', route: '/organization/analytics', order: 6 } });

  // 3. Ensure CONTRACT & BILLING items are active and correctly parented
  await col.updateOne({ id: 'web3_group_contract_billing' }, { $set: { label: 'CONTRACT & BILLING', visibility: true, status: 'ACTIVE', contractTypeVisibility: 'SELF_SERVICE', order: 3 } });
  await col.updateOne({ id: 'web3_billing_contracts' }, { $set: { label: 'Enterprise Contracts', visibility: true, status: 'ACTIVE', contractTypeVisibility: 'SELF_SERVICE', parentId: 'web3_group_contract_billing', order: 1, route: '/billing/contracts' } });
  await col.updateOne({ id: 'web3_billing_invoices' }, { $set: { label: 'Invoices & Payments', visibility: true, status: 'ACTIVE', contractTypeVisibility: 'SELF_SERVICE', parentId: 'web3_group_contract_billing', order: 2, route: '/billing/invoices' } });
  await col.updateOne({ id: 'web3_billing_usage' }, { $set: { label: 'Service Usage & Quotas', visibility: true, status: 'ACTIVE', contractTypeVisibility: 'SELF_SERVICE', parentId: 'web3_group_contract_billing', order: 3, route: '/billing/usage' } });

  // 4. COLLABORATION
  await col.updateOne({ id: 'web3_group_collaboration' }, { $set: { label: 'COLLABORATION', visibility: true, status: 'ACTIVE', contractTypeVisibility: 'ALL', order: 4 } });
  await col.updateOne({ id: 'web3_meetings' }, { $set: { label: 'Meeting Scheduler', visibility: true, status: 'ACTIVE', contractTypeVisibility: 'ALL', parentId: 'web3_group_collaboration', order: 1, route: '/meetings' } });

  // 5. ACCOUNT
  await col.updateOne({ id: 'web3_group_account' }, { $set: { label: 'ACCOUNT', visibility: true, status: 'ACTIVE', contractTypeVisibility: 'ALL', order: 5 } });
  await col.updateOne({ id: 'web3_acc_profile' }, { $set: { label: 'Profile & Security', visibility: true, status: 'ACTIVE', parentId: 'web3_group_account', order: 1, route: '/account/profile' } });
  await col.updateOne({ id: 'web3_acc_company' }, { $set: { label: 'Company Legal Profile', visibility: true, status: 'ACTIVE', parentId: 'web3_group_account', order: 2, route: '/settings/organization' } });
  await col.updateOne({ id: 'web3_acc_preferences' }, { $set: { label: 'Preferences', visibility: true, status: 'ACTIVE', parentId: 'web3_group_account', order: 3, route: '/account/preferences' } });
  await col.updateOne({ id: 'web3_acc_password' }, { $set: { label: 'Change Password', visibility: true, status: 'ACTIVE', parentId: 'web3_group_account', order: 4, route: '/account/security/password' } });
  await col.updateOne({ id: 'web3_acc_2fa' }, { $set: { label: 'Two-Factor Authentication', visibility: true, status: 'ACTIVE', parentId: 'web3_group_account', order: 5, route: '/account/security/2fa' } });
  await col.updateOne({ id: 'web3_acc_sessions' }, { $set: { label: 'Active Sessions', visibility: true, status: 'ACTIVE', parentId: 'web3_group_account', order: 6, route: '/account/security/sessions' } });

  // 6. Deactivate unwanted groups and items that conflict with MenuBuilder
  await col.updateMany(
    { id: { $in: [
      'web3_group_resources', 'web3_docs', 'web3_user_guide', 'web3_modernization_guide', 'web3_contact',
      'web3_group_service_contract', 'web3_billing_upgrade',
      'web3_group_project_management', 'web3_mng_projects', 'web3_mng_files', 'web3_mng_documents', 'web3_mng_deliverables', 'web3_mng_activity',
      'web3_group_communication', 'web3_comm_conversations', 'web3_comm_meetings', 'web3_comm_support'
    ] } },
    { $set: { visibility: false, status: 'INACTIVE' } }
  );

  console.log('MongoDB menu_items updated successfully to match MenuBuilder!');
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
