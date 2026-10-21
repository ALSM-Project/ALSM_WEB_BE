import mongoose from 'mongoose';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://alsm_project:alsm2026@alsm-cluster.d23mpyz.mongodb.net/alsm?retryWrites=true&w=majority&appName=ALSM-Cluster';

interface ActorDefinition {
  email: string;
  fullName: string;
  roleId: string;
  isPlatformAdmin: boolean;
  notes: string;
}

const ACTORS: ActorDefinition[] = [
  {
    email: 'admin@alsm.io',
    fullName: 'System Administrator',
    roleId: 'SYSTEM_ADMIN',
    isPlatformAdmin: true,
    notes: 'Platform Admin: Toàn quyền truy cập tất cả màn hình (Menu Builder, User & Role RBAC, Platform Admin, etc.)',
  },
  {
    email: 'teamlead@alsm.io',
    fullName: 'Trần Văn Tiên (Team Lead)',
    roleId: 'TEAM_LEAD',
    isPlatformAdmin: false,
    notes: 'Team Lead: Quản lý nhóm, phân bổ nhân sự (Employee Allocation), Temporary Roles, Online Meetings, Resource Transfers',
  },
  {
    email: 'staff@alsm.io',
    fullName: 'Nguyễn Văn Staff (Conversion Staff)',
    roleId: 'CONVERSION_STAFF',
    isPlatformAdmin: false,
    notes: 'Conversion Staff: Công việc được giao (My Assigned Work), Conversion Queue, Workspace chuyển đổi mã nguồn',
  },
  {
    email: 'sales@alsm.io',
    fullName: 'Lê Văn Sales (Sales Manager)',
    roleId: 'SALES_MANAGER',
    isPlatformAdmin: false,
    notes: 'Sales Manager: Quản lý Leads, Pipeline bán hàng, Báo cáo doanh số (Sales Reports), Team Performance, Duyệt giảm giá (Discount Approvals), Enterprise Quotes',
  },
  {
    email: 'sales_staff@alsm.io',
    fullName: 'Phạm Thị Sales (Internal Sales)',
    roleId: 'INTERNAL_SALES',
    isPlatformAdmin: false,
    notes: 'Internal Sales: Quản lý Leads, Sales Pipeline, Enterprise Quotes, gửi yêu cầu xin duyệt giảm giá',
  },
  {
    email: 'support@alsm.io',
    fullName: 'Hoàng Văn Support (Internal Support)',
    roleId: 'INTERNAL_SUPPORT',
    isPlatformAdmin: false,
    notes: 'Customer Support: Quyền truy cập tổ chức (Organisation Access / Impersonation), Conversion Support troubleshooting, Service Usage',
  },
  {
    email: 'partner@alsm.io',
    fullName: 'Marcus Vance (Partner Lead)',
    roleId: 'PARTNER',
    isPlatformAdmin: false,
    notes: 'Partner: Quản lý Partner Directory, Partner Projects, Demo Projects',
  },
  {
    email: 'enterprise@alsm.io',
    fullName: 'FPT Software (Enterprise Member)',
    roleId: 'ENTERPRISE_MEMBER',
    isPlatformAdmin: false,
    notes: 'Enterprise Client: Tự chuyển đổi mã nguồn, xem tiến độ và tải kết quả',
  },
];

async function seed() {
  console.log('Connecting to MongoDB at:', MONGODB_URI.replace(/:\/\/[^:]+:[^@]+@/, '://***:***@'));
  await mongoose.connect(MONGODB_URI);
  console.log('Connected successfully!');

  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('Database connection not established');
  }

  const usersCollection = db.collection('users');
  const userRolesCollection = db.collection('user_roles');
  const rolesCollection = db.collection('roles');
  const rolePermissionsCollection = db.collection('role_permissions');
  const orgsCollection = db.collection('organizations');

  const defaultPassword = 'Password123!';
  const passwordHash = await bcrypt.hash(defaultPassword, 10);

  console.log(`\n================================================================`);
  console.log(`SEEDING ACTOR ACCOUNTS (Default Password: ${defaultPassword})`);
  console.log(`================================================================\n`);

  for (const actor of ACTORS) {
    const normalizedEmail = actor.email.trim().toLowerCase();

    // 1. Ensure User exists and is active, verified, unlocked
    let user = await usersCollection.findOne({ email: normalizedEmail });
    const now = new Date();

    if (!user) {
      const insertResult = await usersCollection.insertOne({
        email: normalizedEmail,
        fullName: actor.fullName,
        passwordHash,
        isPlatformAdmin: actor.isPlatformAdmin,
        isActive: true,
        isEmailVerified: true,
        mustChangePassword: false,
        isLocked: false,
        mfa: {
          enabled: false,
          secret: null,
          setupFailureCount: 0,
          backupCodeHashes: [],
        },
        createdAt: now,
        updatedAt: now,
      });
      user = await usersCollection.findOne({ _id: insertResult.insertedId });
      console.log(`[CREATED] User: ${normalizedEmail} (ID: ${user?._id})`);
    } else {
      await usersCollection.updateOne(
        { _id: user._id },
        {
          $set: {
            fullName: actor.fullName,
            passwordHash,
            isPlatformAdmin: actor.isPlatformAdmin,
            isActive: true,
            isEmailVerified: true,
            isLocked: false,
            mustChangePassword: false,
            updatedAt: now,
          },
        }
      );
      console.log(`[UPDATED] User: ${normalizedEmail} (ID: ${user._id})`);
    }

    const userIdStr = user?._id.toString();

    // 2. Assign Role in user_roles collection
    const existingUserRole = await userRolesCollection.findOne({
      userId: userIdStr,
      roleId: actor.roleId,
    });

    if (!existingUserRole) {
      await userRolesCollection.insertOne({
        userId: userIdStr,
        roleId: actor.roleId,
        createdAt: now,
        updatedAt: now,
      });
      console.log(`  -> Assigned role ${actor.roleId} to user ${userIdStr}`);
    } else {
      console.log(`  -> Role ${actor.roleId} already assigned`);
    }

    // 3. Ensure an organization exists where this user is member
    const userObjId = user?._id;
    const existingOrg = await orgsCollection.findOne({ 'members.userId': userObjId });
    if (!existingOrg) {
      await orgsCollection.insertOne({
        name: `${actor.fullName}'s Organization`,
        type: actor.isPlatformAdmin ? 'ENTERPRISE' : 'SELF_SERVICE',
        members: [{ userId: userObjId, role: 'OWNER' }],
        status: 'ACTIVE',
        engagementType: 'Trial',
        limits: {
          maxScreens: 50,
          maxPrograms: 30,
          maxStorageGb: 10,
        },
        createdAt: now,
        updatedAt: now,
      });
      console.log(`  -> Created default organization for ${actor.email}`);
    }
  }

  // Print summary of accounts and roles
  console.log(`\n================================================================`);
  console.log(`SUMMARY OF ACTOR ACCOUNTS READY FOR LOGIN`);
  console.log(`================================================================`);
  console.table(
    ACTORS.map((a) => ({
      Actor: a.roleId,
      Email: a.email,
      Password: defaultPassword,
      'Full Name': a.fullName,
      'Platform Admin': a.isPlatformAdmin,
    }))
  );

  await mongoose.disconnect();
  console.log('Done!');
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
