const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

async function migrate() {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  const db = mongoose.connection.db;
  console.log('Connected to MongoDB');

  const menuCol = db.collection('menu_items');

  // 1. Update ORGANIZATION group and all its children to contractTypeVisibility: 'ALL'
  // and include PARTNER in requiredRoles
  const allowedEnterpriseRoles = [
    'OWNER',
    'ORGANIZATION_OWNER',
    'ADMIN',
    'ENTERPRISE_ADMIN',
    'PARTNER',
    'ENTERPRISE_CUSTOMER',
    'ENTERPRISE_MEMBER',
  ];

  const orgUpdateResult = await menuCol.updateMany(
    {
      application: 'WEB_3',
      $or: [
        { id: 'web3_group_organization' },
        { parentId: 'web3_group_organization' },
        { label: /Organization/i },
        { route: { $regex: /^\/settings\/(organization|team|roles)|^\/organization/ } },
      ],
    },
    {
      $set: {
        contractTypeVisibility: 'ALL',
        requiredRoles: allowedEnterpriseRoles,
      },
    }
  );
  console.log('Updated ORGANIZATION items:', orgUpdateResult.modifiedCount);

  // 2. Update CONTRACT & BILLING group and its children to contractTypeVisibility: 'ALL'
  const billingUpdateResult = await menuCol.updateMany(
    {
      application: 'WEB_3',
      $or: [
        { id: 'web3_group_contract_billing' },
        { parentId: 'web3_group_contract_billing' },
        { label: /CONTRACT & BILLING|Enterprise Contracts|Invoices & Payments|Service Usage/i },
        { route: { $regex: /^\/billing/ } },
      ],
    },
    {
      $set: {
        contractTypeVisibility: 'ALL',
      },
    }
  );
  console.log('Updated CONTRACT & BILLING items:', billingUpdateResult.modifiedCount);

  // 3. Update COLLABORATION to 'ALL'
  const collabUpdateResult = await menuCol.updateMany(
    {
      application: 'WEB_3',
      $or: [
        { id: 'web3_group_collaboration' },
        { parentId: 'web3_group_collaboration' },
        { label: /COLLABORATION|Meeting/i },
        { route: { $regex: /^\/meetings/ } },
      ],
    },
    {
      $set: {
        contractTypeVisibility: 'ALL',
      },
    }
  );
  console.log('Updated COLLABORATION items:', collabUpdateResult.modifiedCount);

  // 4. Verify user hoang's organization and contract
  const user = await db.collection('users').findOne({ email: 'hoangndhde180637@fpt.edu.vn' });
  if (user) {
    console.log('User hoang:', user._id, 'role:', user.role, 'orgId:', user.organizationId);
    if (user.organizationId) {
      await db.collection('organizations').updateOne(
        { _id: user.organizationId },
        { $set: { serviceMode: 'WE_CONVERT_FOR_YOU', status: 'ACTIVE' } }
      );
      console.log('Ensured organization Fintech Nexus is WE_CONVERT_FOR_YOU');
    }

    // Also ensure active contract is WE_CONVERT_FOR_YOU
    const contractResult = await db.collection('contracts').updateMany(
      {
        $or: [
          { organizationId: user.organizationId },
          { customerUserId: user._id },
          { 'customer.contactEmail': user.email }
        ]
      },
      {
        $set: {
          serviceMode: 'WE_CONVERT_FOR_YOU',
          contractType: 'WE_CONVERT_FOR_YOU',
          status: 'ACTIVE'
        }
      }
    );
    console.log('Updated user contracts to WE_CONVERT_FOR_YOU:', contractResult.modifiedCount);
  }

  await mongoose.disconnect();
  console.log('Migration completed successfully!');
}

migrate().catch(console.error);
