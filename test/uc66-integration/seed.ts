import { hash } from 'bcrypt';
import { Connection, Types } from 'mongoose';
import { User } from '../../src/modules/users/infrastructure/user.schema';
import { Organization } from '../../src/modules/organizations/infrastructure/organization.schema';
import { Role } from '../../src/modules/rbac/infrastructure/schemas/role.schema';
import { Permission } from '../../src/modules/rbac/infrastructure/schemas/permission.schema';
import { RolePermission } from '../../src/modules/rbac/infrastructure/schemas/role-permission.schema';
import { UserRole } from '../../src/modules/rbac/infrastructure/schemas/user-role.schema';

export const uc66Ids = {
  actor: '111111111111111111111111',
  organization: '333333333333333333333333',
  otherOrganization: '444444444444444444444444',
  project: '200000000000000000000001',
  screen: '300000000000000000000001',
  program: '300000000000000000000002',
  job: '400000000000000000000001',
  run: '500000000000000000000001',
  finding: '600000000000000000000001',
  error: '700000000000000000000001',
};
export const uc66Credentials = {
  email: 'uc66-05a@example.invalid',
  password: 'Owned-UC66-05A-Only!',
};
export async function seedUc66(connection: Connection) {
  const oid = (id: string) => new Types.ObjectId(id);
  await connection.model(User.name).create({
    _id: uc66Ids.actor,
    ...uc66Credentials,
    password: undefined,
    passwordHash: await hash(uc66Credentials.password, 4),
    fullName: 'UC66 Test Staff',
    isActive: true,
    isLocked: false,
    isEmailVerified: true,
  });
  await connection
    .model(Role.name)
    .create({ id: 'INTERNAL_SUPPORT', name: 'Internal Support', isSystem: true });
  await connection
    .model(Permission.name)
    .create({ key: 'organizations.impersonate', label: 'Support Organisation', group: 'support' });
  await connection
    .model(RolePermission.name)
    .create({ roleId: 'INTERNAL_SUPPORT', permissionKey: 'organizations.impersonate' });
  await connection
    .model(UserRole.name)
    .create({ userId: uc66Ids.actor, roleId: 'INTERNAL_SUPPORT' });
  await connection.model(Organization.name).create([
    {
      _id: uc66Ids.organization,
      name: 'UC66 Customer Example',
      contactEmail: 'uc66-contact@example.invalid',
      type: 'ENTERPRISE',
      status: 'ACTIVE',
      members: [],
    },
    {
      _id: uc66Ids.otherOrganization,
      name: 'UC66 Other Customer',
      contactEmail: 'other-contact@example.invalid',
      type: 'SELF_SERVICE',
      status: 'ACTIVE',
      members: [],
    },
  ]);
  const scope = {
    organizationId: oid(uc66Ids.organization),
    projectId: oid(uc66Ids.project),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await connection.collection('projects').insertMany(
    Array.from({ length: 25 }, (_, i) => ({
      _id: oid(`200000000000000000${(i + 1).toString(16).padStart(6, '0')}`),
      organizationId: scope.organizationId,
      name: `Project ${String(i + 1).padStart(2, '0')}`,
      status: 'ACTIVE',
      conversionType: 'COBOL_TO_JAVA',
      deletedAt: null,
      createdAt: scope.createdAt,
      updatedAt: scope.updatedAt,
    })),
  );
  await connection.collection('screens').insertMany([
    {
      _id: oid(uc66Ids.screen),
      ...scope,
      name: 'Account BMS',
      sourceType: 'BMS',
      status: 'READY',
      dependencyStatus: 'NOT_ANALYZED',
      sizeBytes: 100,
    },
    {
      _id: oid(uc66Ids.program),
      ...scope,
      name: 'Account COBOL',
      sourceType: 'COBOL',
      status: 'READY',
      dependencyStatus: 'NOT_ANALYZED',
      sizeBytes: 200,
    },
  ]);
  await connection.collection('conversion_jobs').insertOne({
    _id: oid(uc66Ids.job),
    ...scope,
    screenId: uc66Ids.program,
    status: 'FAILED',
    conversionType: 'COBOL_TO_JAVA',
    attemptCount: 1,
    maxAttempts: 3,
  });
  await connection.collection('validation_runs').insertOne({
    _id: oid(uc66Ids.run),
    ...scope,
    conversionJobId: oid(uc66Ids.job),
    status: 'COMPLETED',
  });
  await connection.collection('validation_findings').insertOne({
    _id: oid(uc66Ids.finding),
    ...scope,
    conversionJobId: oid(uc66Ids.job),
    validationRunId: oid(uc66Ids.run),
    source: 'RULE',
    category: 'LOGIC_MISMATCH',
    severity: 'HIGH',
    status: 'PENDING',
    confidence: 0.8,
  });
  await connection.collection('error_logs').insertOne({
    _id: oid(uc66Ids.error),
    ...scope,
    severity: 'ERROR',
    status: 'UNRESOLVED',
    lineNumber: 42,
  });
}
