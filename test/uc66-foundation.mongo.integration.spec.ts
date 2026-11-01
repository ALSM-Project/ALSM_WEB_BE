import 'reflect-metadata';
import { ForbiddenException, INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Connection, createConnection, Model, mongo, Types } from 'mongoose';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest');
import { ApiExceptionFilter } from '../src/shared/errors/api-exception.filter';
import { PlatformAdminAccessService } from '../src/modules/admin/application/platform-admin-access.service';
import { OrganizationContextService } from '../src/modules/organizations/application/organization-context.service';
import { OrganizationAuthorizationService } from '../src/modules/organizations/application/organization-authorization.service';
import { MongoOrganizationRepository } from '../src/modules/organizations/infrastructure/mongo-organization.repository';
import {
  Organization,
  OrganizationSchema,
} from '../src/modules/organizations/infrastructure/organization.schema';
import {
  OrganizationRole,
  OrganizationType,
} from '../src/modules/organizations/domain/organization.types';
import { User } from '../src/modules/users/infrastructure/user.schema';
import { UserSession } from '../src/modules/auth/infrastructure/user-session.schema';
import { Role } from '../src/modules/rbac/infrastructure/schemas/role.schema';
import { Permission } from '../src/modules/rbac/infrastructure/schemas/permission.schema';
import { UserRole } from '../src/modules/rbac/infrastructure/schemas/user-role.schema';
import { RolePermission } from '../src/modules/rbac/infrastructure/schemas/role-permission.schema';
import { TemporaryRole } from '../src/modules/rbac/infrastructure/schemas/temporary-role.schema';
import {
  SUPPORT_STAFF_AUTHORITY,
  SupportStaffAuthorityPort,
} from '../src/modules/rbac/domain/support-staff-authority.port';
import { AuditLog } from '../src/modules/audit/infrastructure/audit-log.schema';
import {
  TRANSACTIONAL_AUDIT_FACTORY,
  TransactionalAuditFactory,
} from '../src/modules/audit/domain/transactional-audit.port';
import { MongoSupportContextUnitOfWork } from '../src/modules/support/infrastructure/mongo-support-context.unit-of-work';
import { ProjectsController } from '../src/modules/projects/presentation/projects.controller';
import { ProjectService } from '../src/modules/projects/application/project.service';
import { PROJECT_REPOSITORY } from '../src/modules/projects/domain/project.types';
import { SupportFoundationModule } from '../src/modules/support/support-foundation.module';
import {
  SUPPORT_CLOCK,
  SUPPORT_CONTEXT_UNIT_OF_WORK,
  SupportContextParticipants,
  SupportContextUnitOfWork,
} from '../src/modules/support/application/support-context.ports';
import { AuthorizeSupportContextReadService } from '../src/modules/support/application/authorize-support-context-read.service';
import {
  SUPPORT_ACTIVE_ORIGIN_INDEX,
  SUPPORT_CONTEXT_MODEL,
  SupportContextSnapshot,
} from '../src/modules/support/infrastructure/support-context.schema';
import {
  supportOrganizationId,
  supportSessionId,
  supportUserId,
  otherSupportOrganizationId,
} from './uc66-foundation.fixtures';

// Hardcoded loopback topology + ownership checks; never accepts env-file/arbitrary DB URLs.
const owned = process.env.ALSM_UC66_TEST === 'owned-local-only' ? describe : describe.skip;
owned('UC66-01/02 isolated HTTP module with real owned Mongo transactions', () => {
  jest.setTimeout(60000);
  const runId = randomUUID().replaceAll('-', '');
  const database = `alsm_uc66_foundation_${runId}`;
  const uri = `mongodb://127.0.0.1:27128/${database}?replicaSet=alsmUc66Foundation&directConnection=true`;
  const secret = `test-only-${randomUUID()}`;
  const customerId = '555555555555555555555555';
  const customerSession = '666666666666666666666666';
  const internalOrgId = '777777777777777777777777';
  const base = '/api/v1/support/organizations';
  const contexts = `${base}/${supportOrganizationId}/contexts`;
  const control = { time: Date.now() };
  const clock = { now: () => new Date(control.time) };
  const jwt = new JwtService({ secret });
  const projectWrites = { create: jest.fn(async (input) => ({ id: 'test-project', ...input })) };
  let app: INestApplication | undefined;
  let connection: Connection;
  let ownership: Connection | undefined;
  let model: Model<SupportContextSnapshot>;
  let userModel: Model<User>;
  let sessionModel: Model<UserSession>;
  let roleModel: Model<Role>;
  let permissionModel: Model<Permission>;
  let userRoleModel: Model<UserRole>;
  let grantModel: Model<RolePermission>;
  let tempModel: Model<TemporaryRole>;
  let orgModel: Model<Organization>;
  let auditModel: Model<AuditLog>;

  function verifyContainer() {
    const [info] = JSON.parse(
      execFileSync('docker', ['inspect', 'alsm-uc66-foundation-20261101-mongo'], {
        encoding: 'utf8',
        windowsHide: true,
      }),
    );
    expect(info.State.Running).toBe(true);
    expect(info.Config.Labels['alsm.owner']).toBe('uc66-foundation-20261101');
    expect(info.NetworkSettings.Ports['27017/tcp']).toEqual([
      { HostIp: '127.0.0.1', HostPort: '27128' },
    ]);
  }

  async function verifyDatabase() {
    expect(connection.name).toBe(database);
    expect(database).toMatch(/^alsm_uc66_foundation_[a-f0-9]{32}$/);
    expect(
      await connection.collection('_uc66_test_owner').findOne({ runId, database }),
    ).toBeTruthy();
  }

  function injectCommitAcknowledgementLoss(error: () => Error) {
    const counts = { businessCallbacks: 0, commitCalls: 0 };
    const unit = app!.get<SupportContextUnitOfWork>(SUPPORT_CONTEXT_UNIT_OF_WORK);
    const originalRun = unit.run.bind(unit);
    const countedRun = <T>(id: string, work: (ports: SupportContextParticipants) => Promise<T>) =>
      originalRun(id, async (ports) => {
        counts.businessCallbacks++;
        return work(ports);
      });
    const run = jest.spyOn(unit, 'run').mockImplementation(countedRun);
    const originalStart = connection.startSession.bind(connection);
    const start = jest.spyOn(connection, 'startSession').mockImplementationOnce(async (options) => {
      const session = await originalStart(options);
      const commit = session.commitTransaction.bind(session);
      // Fault the actual Core API commit, inside any installed-driver retry loop.
      session.commitTransaction = async (...args: Parameters<typeof commit>) => {
        counts.commitCalls++;
        await commit(...args);
        if (counts.commitCalls === 1) throw error();
      };
      return session;
    });
    return {
      counts,
      restore: () => {
        start.mockRestore();
        run.mockRestore();
      },
    };
  }

  const token = (user = supportUserId, claims: object = {}) =>
    jwt.sign(
      {
        sub: user,
        email: 'fixture@example.invalid',
        sid: user === customerId ? customerSession : supportSessionId,
        sv: 'original-generation',
        isPlatformAdmin: false,
        ...claims,
      },
      { expiresIn: '1h' },
    );
  function call(method: 'get' | 'post', path: string, body?: object, auth = token()) {
    const operation = request(app!.getHttpServer())
      [method](path)
      .set('Authorization', `Bearer ${auth}`);
    return body === undefined ? operation : operation.send(body);
  }
  async function enter() {
    const result = await call('post', contexts, {}).expect(201);
    return result.body.id as string;
  }
  const status = (id: string, org = supportOrganizationId) =>
    call('get', `${base}/${org}/contexts/${id}`);
  const exit = (id: string) => call('post', `${contexts}/${id}/exit`, {});

  beforeAll(async () => {
    verifyContainer();
    ownership = await createConnection(uri, { serverSelectionTimeoutMS: 3000 }).asPromise();
    expect(await ownership.db!.listCollections().toArray()).toHaveLength(0);
    await ownership.collection('_uc66_test_owner').insertOne({ runId, database });
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule,
        JwtModule.register({}),
        MongooseModule.forRoot(uri, {
          serverSelectionTimeoutMS: 3000,
          connectionFactory: (conn: Connection) => {
            connection = conn;
            return conn;
          },
        }),
        MongooseModule.forFeature([{ name: Organization.name, schema: OrganizationSchema }]),
        SupportFoundationModule,
      ],
      controllers: [ProjectsController],
      providers: [
        ProjectService,
        OrganizationAuthorizationService,
        { provide: PROJECT_REPOSITORY, useValue: projectWrites },
        {
          provide: PlatformAdminAccessService,
          useValue: {
            authorize: async () => {
              throw new ForbiddenException();
            },
          },
        },
        {
          provide: OrganizationContextService,
          inject: [getModelToken(Organization.name)],
          useFactory: (orgs: Model<Organization>) =>
            new OrganizationContextService(new MongoOrganizationRepository(orgs)),
        },
      ],
    })
      .overrideProvider(ConfigService)
      .useValue(new ConfigService({ JWT_ACCESS_SECRET: secret }))
      .overrideProvider(SUPPORT_CLOCK)
      .useValue(clock)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
    connection = app.get(getConnectionToken());
    expect((await connection.db!.admin().command({ hello: 1 })).setName).toBe('alsmUc66Foundation');
    await Promise.all(Object.values(connection.models).map((m) => m.init()));
    model = connection.model<SupportContextSnapshot>(SUPPORT_CONTEXT_MODEL);
    userModel = connection.model<User>(User.name);
    sessionModel = connection.model<UserSession>(UserSession.name);
    roleModel = connection.model<Role>(Role.name);
    permissionModel = connection.model<Permission>(Permission.name);
    userRoleModel = connection.model<UserRole>(UserRole.name);
    grantModel = connection.model<RolePermission>(RolePermission.name);
    tempModel = connection.model<TemporaryRole>(TemporaryRole.name);
    orgModel = connection.model<Organization>(Organization.name);
    auditModel = connection.model<AuditLog>(AuditLog.name);
  });

  beforeEach(async () => {
    await verifyDatabase();
    control.time = Date.now();
    await connection.db!.command({
      collMod: 'audit_logs',
      validator: {},
      validationLevel: 'strict',
    });
    await connection.db!.command({
      collMod: 'support_contexts',
      validator: {},
      validationLevel: 'strict',
    });
    for (const m of [
      model,
      userModel,
      sessionModel,
      roleModel,
      permissionModel,
      userRoleModel,
      grantModel,
      tempModel,
      orgModel,
      auditModel,
    ])
      await m.collection.deleteMany({});
    projectWrites.create.mockClear();
    await userModel.create([
      {
        _id: supportUserId,
        email: 'support@example.invalid',
        fullName: 'Support fixture',
        isActive: true,
        isLocked: false,
        isEmailVerified: true,
      },
      {
        _id: customerId,
        email: 'customer@example.invalid',
        fullName: 'Customer fixture',
        isActive: true,
        isLocked: false,
        isEmailVerified: true,
      },
    ]);
    await sessionModel.create([
      {
        _id: supportSessionId,
        userId: supportUserId,
        tokenId: randomUUID(),
        accessVersion: 'original-generation',
        refreshTokenHash: 'test-only',
        expiresAt: new Date(control.time + 2 * 3600000),
      },
      {
        _id: customerSession,
        userId: customerId,
        tokenId: randomUUID(),
        accessVersion: 'original-generation',
        refreshTokenHash: 'test-only',
        expiresAt: new Date(control.time + 2 * 3600000),
      },
    ]);
    await roleModel.create({ id: 'INTERNAL_SUPPORT', name: 'Internal Support', isSystem: true });
    await permissionModel.create({
      key: 'organizations.impersonate',
      label: 'Impersonate Organisation',
      group: 'support',
    });
    await grantModel.create({
      roleId: 'INTERNAL_SUPPORT',
      permissionKey: 'organizations.impersonate',
    });
    await userRoleModel.create({ userId: supportUserId, roleId: 'INTERNAL_SUPPORT' });
    await orgModel.create([
      {
        _id: supportOrganizationId,
        name: 'Customer Example',
        contactEmail: 'contact+uc66@example.invalid',
        type: OrganizationType.SELF_SERVICE,
        status: 'ACTIVE',
        members: [{ userId: customerId, role: OrganizationRole.OWNER }],
      },
      {
        _id: otherSupportOrganizationId,
        name: 'Customer Other',
        contactEmail: 'other@example.invalid',
        type: OrganizationType.ENTERPRISE,
        status: 'ACTIVE',
      },
      {
        _id: internalOrgId,
        name: 'Customer Internal',
        contactEmail: 'internal@example.invalid',
        type: OrganizationType.INTERNAL,
        status: 'ACTIVE',
      },
    ]);
  });

  afterAll(async () => {
    if (connection) {
      verifyContainer();
      await verifyDatabase();
      await connection.dropDatabase();
    }
    if (app) await app.close();
    else await connection?.close();
    await ownership?.close();
  });

  it('searches real Organisation name/contactEmail with safe bounded metadata and pagination', async () => {
    const first = await call('get', `${base}?query=Customer&limit=1`).expect(200);
    expect(first.body.items).toHaveLength(1);
    expect(first.body.nextAfterId).toBe(supportOrganizationId);
    expect(Object.keys(first.body.items[0]).sort()).toEqual(['id', 'name', 'status', 'type']);
    const next = await call(
      'get',
      `${base}?query=Customer&limit=1&afterId=${first.body.nextAfterId}`,
    ).expect(200);
    expect(next.body.items[0].id).toBe(otherSupportOrganizationId);
    expect(next.body.nextAfterId).toBeNull();
    const email = await call(
      'get',
      `${base}?field=email&query=${encodeURIComponent('CONTACT+UC66@example.invalid')}`,
    ).expect(200);
    expect(email.body.items.map((r: { id: string }) => r.id)).toEqual([supportOrganizationId]);
    expect(JSON.stringify(email.body)).not.toContain('contact+uc66');
  });

  it('escapes regex metacharacters and rejects empty/unbounded/unknown search input', async () => {
    const literal = await call('get', `${base}?query=${encodeURIComponent('Cus.*')}`).expect(200);
    expect(literal.body.items).toHaveLength(0);
    for (const query of [
      '',
      '?query=ab',
      '?query=Customer&limit=26',
      '?query=Customer&role=INTERNAL_SUPPORT',
      '?query=Customer&afterId=forged',
    ])
      await call('get', base + query).expect(400);
  });

  it('requires authentication and denies a customer or forged JWT roles/permissions', async () => {
    await request(app!.getHttpServer()).get(`${base}?query=Customer`).expect(401);
    await call(
      'get',
      `${base}?query=Customer`,
      undefined,
      token(customerId, { role: 'INTERNAL_SUPPORT', permissions: ['organizations.impersonate'] }),
    ).expect(403);
  });

  it('does not grant access to a persisted Platform Admin without the support assignment', async () => {
    await userModel.updateOne({ _id: customerId }, { $set: { isPlatformAdmin: true } });
    await call(
      'get',
      `${base}?query=Customer`,
      undefined,
      token(customerId, { isPlatformAdmin: true }),
    ).expect(403);
    await call('post', contexts, {}, token(customerId, { isPlatformAdmin: true })).expect(403);
  });

  it('requires the support role permission itself, not an Admin/global permission expansion', async () => {
    await userModel.updateOne({ _id: supportUserId }, { $set: { isPlatformAdmin: true } });
    await grantModel.deleteMany({ roleId: 'INTERNAL_SUPPORT' });
    await call(
      'post',
      contexts,
      {},
      token(supportUserId, { isPlatformAdmin: true, permissions: ['organizations.impersonate'] }),
    ).expect(403);
  });

  it.each(['REVOKED', 'EXPIRED', 'PENDING', 'AMBIGUOUS'])(
    'rejects %s temporary staff authority',
    async (state) => {
      if (state !== 'AMBIGUOUS') await userRoleModel.deleteMany({ userId: supportUserId });
      await tempModel.create({
        userId: supportUserId,
        roleId: 'INTERNAL_SUPPORT',
        grantedBy: customerId,
        grantedAt: new Date(control.time - 1000),
        expiresAt: new Date(control.time + (state === 'EXPIRED' ? -1 : 60000)),
        durationHours: 1,
        status: state === 'REVOKED' ? 'REVOKED' : 'ACTIVE',
        reason: 'TEST only',
        requestStatus: state === 'PENDING' ? 'PENDING' : 'APPROVED',
      });
      await call('get', `${base}?query=Customer`).expect(403);
    },
  );

  it('accepts a single current approved temporary support role and caps the context at its expiry', async () => {
    await userRoleModel.deleteMany({ userId: supportUserId });
    await tempModel.create({
      userId: supportUserId,
      roleId: 'INTERNAL_SUPPORT',
      grantedBy: customerId,
      grantedAt: new Date(control.time - 1000),
      expiresAt: new Date(control.time + 60000),
      durationHours: 1,
      status: 'ACTIVE',
      requestStatus: 'APPROVED',
      reason: 'TEST only',
    });
    const id = await enter();
    expect((await model.findById(id).lean())!.expiresAt).toEqual(new Date(control.time + 60000));
    control.time += 60000;
    await status(id).expect(403);
  });

  it('enters with a real actor/session-bound read-only context and durable ENTER audit, without membership/token issuance', async () => {
    const id = await enter(),
      row = await model.findById(id).lean();
    expect(row).toMatchObject({
      actorUserId: new Types.ObjectId(supportUserId),
      originalSessionId: new Types.ObjectId(supportSessionId),
      organizationId: new Types.ObjectId(supportOrganizationId),
      readOnly: true,
      state: 'ACTIVE',
    });
    expect(row!.expiresAt.getTime() - row!.createdAt.getTime()).toBe(30 * 60000);
    expect(
      await auditModel.countDocuments({
        action: 'SUPPORT_CONTEXT_ENTERED',
        resourceId: id,
        actorUserId: supportUserId,
        organizationId: supportOrganizationId,
      }),
    ).toBe(1);
    expect(
      (await orgModel.findById(supportOrganizationId).lean())!.members.map((m) => String(m.userId)),
    ).toEqual([customerId]);
    expect(await sessionModel.countDocuments()).toBe(2);
    const response = await status(id).expect(200);
    for (const hidden of [
      'accessToken',
      'refreshToken',
      'sessionVersion',
      'authorityBinding',
      'originalSessionId',
    ])
      expect(response.body).not.toHaveProperty(hidden);
  });

  it.each([
    { readOnly: false },
    { readOnly: true },
    { role: 'INTERNAL_SUPPORT' },
    { organizationId: otherSupportOrganizationId },
    { expiresAt: '2099-01-01' },
  ])('rejects caller capability/identity/lifetime field %j', async (body) => {
    await call('post', contexts, body).expect(400);
    expect(await model.countDocuments()).toBe(0);
  });

  it('rejects missing, suspended, internal and expired-trial targets', async () => {
    await orgModel.updateOne({ _id: supportOrganizationId }, { $set: { status: 'SUSPENDED' } });
    await call('post', contexts, {}).expect(404);
    await call('post', `${base}/${internalOrgId}/contexts`, {}).expect(404);
    await call('post', `${base}/999999999999999999999999/contexts`, {}).expect(404);
    await orgModel.updateOne(
      { _id: supportOrganizationId },
      { $set: { status: 'TRIAL', trialExpiresAt: new Date(control.time) } },
    );
    await call('post', contexts, {}).expect(404);
  });

  it('rolls back the context when a real Mongo audit collection validator rejects ENTER', async () => {
    await connection.db!.command({
      collMod: 'audit_logs',
      validator: { action: { $ne: 'SUPPORT_CONTEXT_ENTERED' } },
      validationLevel: 'strict',
      validationAction: 'error',
    });
    await call('post', contexts, {}).expect(503);
    expect(await model.countDocuments()).toBe(0);
    expect(await auditModel.countDocuments()).toBe(0);
  });

  it('fails closed without an ENTER audit if real context persistence rejects the write', async () => {
    await connection.db!.command({
      collMod: 'support_contexts',
      validator: { state: { $ne: 'ACTIVE' } },
      validationLevel: 'strict',
      validationAction: 'error',
    });
    await call('post', contexts, {}).expect(503);
    expect(await model.countDocuments()).toBe(0);
    expect(await auditModel.countDocuments()).toBe(0);
  });

  it('serializes concurrent Enter using the real partial unique index', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => call('post', contexts, {})));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(5);
    expect(await model.countDocuments({ state: 'ACTIVE' })).toBe(1);
    expect(await auditModel.countDocuments({ action: 'SUPPORT_CONTEXT_ENTERED' })).toBe(1);
  });

  it('refuses context mutations if its required index is missing (owned test collection only)', async () => {
    await verifyDatabase();
    await model.collection.dropIndex(SUPPORT_ACTIVE_ORIGIN_INDEX);
    try {
      await call('post', contexts, {}).expect(503);
      expect(await model.countDocuments()).toBe(0);
    } finally {
      await model.createIndexes();
    }
  });

  it('denies forged context IDs, cross-Organisation and cross-session reads without refreshing idle time', async () => {
    const id = await enter(),
      before = await model.findById(id).lean();
    control.time += 60000;
    await status(id, otherSupportOrganizationId).set('x-support-context-id', id).expect(404);
    await status(randomUUID()).expect(404);
    await call('get', `${contexts}/${id}`, undefined, token(customerId)).expect(403);
    const secondSession = new Types.ObjectId();
    await sessionModel.create({
      _id: secondSession,
      userId: supportUserId,
      tokenId: randomUUID(),
      accessVersion: 'original-generation',
      refreshTokenHash: 'TEST',
      expiresAt: new Date(control.time + 60000),
    });
    await call(
      'get',
      `${contexts}/${id}`,
      undefined,
      token(supportUserId, { sid: String(secondSession) }),
    ).expect(404);
    expect((await model.findById(id).lean())!.lastActivityAt).toEqual(before!.lastActivityAt);
    expect(await auditModel.countDocuments({ action: 'SUPPORT_CONTEXT_READ' })).toBe(0);
  });

  it('refreshes idle only for committed, authorized activity and never extends absolute expiration', async () => {
    const id = await enter(),
      initial = (await model.findById(id).lean())!;
    for (const minute of [10, 20, 29]) {
      control.time = initial.createdAt.getTime() + minute * 60000;
      await status(id).expect(200);
    }
    const latest = (await model.findById(id).lean())!;
    expect(latest.lastActivityAt).toEqual(new Date(control.time));
    expect(latest.expiresAt).toEqual(initial.expiresAt);
    control.time = initial.createdAt.getTime() + 30 * 60000;
    await status(id).expect(409);
    expect((await model.findById(id).lean())!.lastActivityAt).toEqual(latest.lastActivityAt);
  });

  it('rejects activity at idle timeout and requires a new explicit authorized Enter', async () => {
    const id = await enter();
    control.time += 15 * 60000;
    await status(id).expect(409);
    const next = await enter();
    expect(next).not.toBe(id);
    expect((await model.findById(id).lean())!.state).toBe('EXPIRED');
  });

  it('does not refresh idle time when real audit persistence rejects an authorized context read', async () => {
    const id = await enter(),
      before = (await model.findById(id).lean())!;
    control.time += 60000;
    await connection.db!.command({
      collMod: 'audit_logs',
      validator: { action: { $ne: 'SUPPORT_CONTEXT_READ' } },
      validationAction: 'error',
    });
    await status(id).expect(503);
    const after = (await model.findById(id).lean())!;
    expect(after.lastActivityAt).toEqual(before.lastActivityAt);
    expect(after.revision).toBe(before.revision);
    expect(await auditModel.countDocuments({ action: 'SUPPORT_CONTEXT_READ' })).toBe(0);
  });

  it('rolls back pending activity/audit when persisted staff authority is removed before commit', async () => {
    const id = await enter(),
      before = (await model.findById(id).lean())!;
    control.time += 60000;
    const reader = app!.get<SupportStaffAuthorityPort>(SUPPORT_STAFF_AUTHORITY),
      current = reader.current.bind(reader);
    let checks = 0;
    const check = jest.spyOn(reader, 'current').mockImplementation(async (userId, now) => {
      if (++checks === 3) await userRoleModel.deleteMany({ userId: supportUserId });
      return current(userId, now);
    });
    try {
      await status(id).expect(403);
      const after = (await model.findById(id).lean())!;
      expect(after.lastActivityAt).toEqual(before.lastActivityAt);
      expect(after.revision).toBe(before.revision);
      expect(await auditModel.countDocuments({ action: 'SUPPORT_CONTEXT_READ' })).toBe(0);
    } finally {
      check.mockRestore();
    }
  });

  it('serializes concurrent authorized activity with one audit per committed read', async () => {
    const id = await enter();
    control.time += 60000;
    const responses = await Promise.all(Array.from({ length: 6 }, () => status(id)));
    expect(responses.map((r) => r.status)).toEqual(Array(6).fill(200));
    const row = (await model.findById(id).lean())!;
    expect(row.revision).toBe(7);
    expect(row.lastActivityAt).toEqual(new Date(control.time));
    expect(
      await auditModel.countDocuments({ action: 'SUPPORT_CONTEXT_READ', resourceId: id }),
    ).toBe(6);
  });

  it('aborts a cross-instance pre-commit write conflict without replay or orphan audit', async () => {
    const id = await enter();
    const factory = app!.get<TransactionalAuditFactory>(TRANSACTIONAL_AUDIT_FACTORY);
    const units = [
      new MongoSupportContextUnitOfWork(connection, model, factory),
      new MongoSupportContextUnitOfWork(connection, model, factory),
    ];
    const callbacks = [0, 0];
    let arrived = 0,
      release!: () => void;
    const bothRead = new Promise<void>((resolve) => {
      release = resolve;
    });
    const results = await Promise.allSettled(
      units.map((unit, index) =>
        unit.run(id, async ({ contexts: repository, audit }) => {
          callbacks[index]++;
          const context = await repository.scoped({
            id,
            actorUserId: supportUserId,
            originalSessionId: supportSessionId,
            organizationId: supportOrganizationId,
          });
          if (!context) throw new Error('TEST missing context');
          const revision = context.toProps().revision;
          if (++arrived === 2) release();
          await bothRead;
          context.activity(new Date(control.time + 1000));
          await repository.save(context, revision);
          await audit.append({
            actorUserId: supportUserId,
            organizationId: supportOrganizationId,
            action: 'SUPPORT_CONTEXT_READ',
            resourceType: 'SUPPORT_CONTEXT',
            resourceId: id,
            metadata: {
              originalSessionId: supportSessionId,
              operation: 'CONTEXT_STATUS',
              mode: 'READ_ONLY',
            },
          });
        }),
      ),
    );
    expect(callbacks).toEqual([1, 1]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.reason).toMatchObject({
      status: 409,
      response: {
        code: 'SUPPORT_CONTEXT_CONFLICT',
        details: [{ contextId: id, mutationCommitted: false, retrySafe: false }],
      },
    });
    expect((await model.findById(id).lean())!.revision).toBe(2);
    expect(
      await auditModel.countDocuments({ resourceId: id, action: 'SUPPORT_CONTEXT_READ' }),
    ).toBe(1);
  });

  it('concurrent Exit is idempotent, audited once and immediately prevents reuse', async () => {
    const id = await enter();
    const results = await Promise.all(Array.from({ length: 4 }, () => exit(id)));
    expect(results.map((r) => r.status)).toEqual(Array(4).fill(200));
    expect((await model.findById(id).lean())!.state).toBe('EXITED');
    expect(
      await auditModel.countDocuments({ action: 'SUPPORT_CONTEXT_EXITED', resourceId: id }),
    ).toBe(1);
    await status(id).expect(409);
  });

  it('rolls back Exit if the real EXIT audit cannot be committed', async () => {
    const id = await enter();
    await connection.db!.command({
      collMod: 'audit_logs',
      validator: { action: { $ne: 'SUPPORT_CONTEXT_EXITED' } },
      validationAction: 'error',
    });
    await exit(id).expect(503);
    expect((await model.findById(id).lean())!.state).toBe('ACTIVE');
  });

  it('fences concurrent reads against Exit without reactivating the context', async () => {
    const id = await enter();
    control.time += 60000;
    const results = await Promise.all([exit(id), ...Array.from({ length: 4 }, () => status(id))]);
    expect(results[0].status).toBe(200);
    for (const result of results.slice(1)) expect([200, 409]).toContain(result.status);
    expect((await model.findById(id).lean())!.state).toBe('EXITED');
    expect(await auditModel.countDocuments({ action: 'SUPPORT_CONTEXT_READ' })).toBe(
      results.slice(1).filter((r) => r.status === 200).length,
    );
  });

  it.each([
    'logout',
    'expired-session',
    'generation',
    'inactive',
    'locked',
    'lost-role',
    'lost-permission',
    'regrant',
  ])('denies context reuse after %s without refreshing activity', async (state) => {
    const id = await enter(),
      before = (await model.findById(id).lean())!;
    if (state === 'logout')
      await sessionModel.updateOne({ _id: supportSessionId }, { $set: { revokedAt: new Date() } });
    if (state === 'expired-session')
      await sessionModel.updateOne({ _id: supportSessionId }, { $set: { expiresAt: new Date(0) } });
    if (state === 'generation')
      await sessionModel.updateOne(
        { _id: supportSessionId },
        { $set: { accessVersion: 'rotated' } },
      );
    if (state === 'inactive')
      await userModel.updateOne({ _id: supportUserId }, { $set: { isActive: false } });
    if (state === 'locked')
      await userModel.updateOne({ _id: supportUserId }, { $set: { isLocked: true } });
    if (state === 'lost-role' || state === 'regrant')
      await userRoleModel.deleteMany({ userId: supportUserId });
    if (state === 'lost-permission') await grantModel.deleteMany({ roleId: 'INTERNAL_SUPPORT' });
    if (state === 'regrant')
      await userRoleModel.create({ userId: supportUserId, roleId: 'INTERNAL_SUPPORT' });
    await status(id).expect(
      ['lost-role', 'lost-permission', 'regrant'].includes(state) ? 403 : 401,
    );
    expect((await model.findById(id).lean())!.lastActivityAt).toEqual(before.lastActivityAt);
  });

  it('does not admit unreviewed read/write operations or use GET as a permission', async () => {
    const id = await enter(),
      service = app!.get(AuthorizeSupportContextReadService);
    for (const operation of ['PROJECT_READ', 'PROJECT_WRITE', 'GET_EXPORT', 'RETRY_CONVERSION'])
      await expect(
        service.execute(
          {
            userId: supportUserId,
            sessionId: supportSessionId,
            sessionVersion: 'original-generation',
          },
          supportOrganizationId,
          id,
          operation,
        ),
      ).rejects.toMatchObject({ status: 403 });
    expect(await auditModel.countDocuments({ action: 'SUPPORT_CONTEXT_READ' })).toBe(0);
  });

  it('a context grants no access to existing customer Project writes; ordinary customer authority still works', async () => {
    const id = await enter(),
      body = { name: 'Test project', conversionType: 'COBOL_TO_JAVA' };
    await call('post', '/api/v1/projects', body)
      .set('x-organization-id', supportOrganizationId)
      .set('x-support-context-id', id)
      .set('x-read-only', 'false')
      .expect(403);
    expect(projectWrites.create).not.toHaveBeenCalled();
    await call('post', '/api/v1/projects', body, id)
      .set('x-organization-id', supportOrganizationId)
      .expect(401);
    await call('post', '/api/v1/projects', body, token(customerId))
      .set('x-organization-id', supportOrganizationId)
      .expect(201);
    expect(projectWrites.create).toHaveBeenCalledTimes(1);
  });

  it('reports an uncertain commit without replay; real committed state/audit can be reconciled by context ID', async () => {
    const fault = injectCommitAcknowledgementLoss(
      () =>
        new mongo.MongoServerError({
          message: 'TEST lost acknowledgement after actual commit',
          code: 11000,
          errorLabels: ['UnknownTransactionCommitResult', 'TransientTransactionError'],
        }),
    );
    try {
      const response = await call('post', contexts, {}).expect(503);
      expect(response.body.code).toBe('SUPPORT_CONTEXT_OUTCOME_UNCONFIRMED');
      expect(response.body.details[0]).toMatchObject({
        mutationCommitted: 'unknown',
        retrySafe: false,
      });
      expect(await model.countDocuments()).toBe(1);
      expect(await auditModel.countDocuments({ action: 'SUPPORT_CONTEXT_ENTERED' })).toBe(1);
      expect(fault.counts).toEqual({ businessCallbacks: 1, commitCalls: 1 });
      await status(response.body.details[0].contextId).expect(200);
    } finally {
      fault.restore();
    }
  });

  const commitFaults = [
    {
      name: 'code 50 mixed labels',
      body: { code: 50 },
      labels: ['UnknownTransactionCommitResult', 'TransientTransactionError'],
    },
    {
      name: 'nested writeConcernError code 50 mixed labels',
      body: { writeConcernError: { code: 50 } },
      labels: ['UnknownTransactionCommitResult', 'TransientTransactionError'],
    },
    {
      name: 'top-level 64 and nested code 50 mixed labels',
      body: { code: 64, writeConcernError: { code: 50 } },
      labels: ['UnknownTransactionCommitResult', 'TransientTransactionError'],
    },
    {
      name: 'code 11000 control',
      body: { code: 11000 },
      labels: ['UnknownTransactionCommitResult', 'TransientTransactionError'],
    },
    {
      name: 'code 50 unknown-only label',
      body: { code: 50 },
      labels: ['UnknownTransactionCommitResult'],
    },
    { name: 'code 50 without labels', body: { code: 50 }, labels: [] },
  ];

  it.each(commitFaults)(
    'keeps committed activity unconfirmed without replay: $name',
    async ({ body, labels }) => {
      const id = await enter();
      const before = (await model.findById(id).lean())!;
      control.time += 1000;
      const fault = injectCommitAcknowledgementLoss(
        () =>
          new mongo.MongoServerError({
            message: 'TEST acknowledgement loss after actual commit',
            ...body,
            errorLabels: labels,
          }),
      );
      try {
        const response = await status(id);
        const row = (await model.findById(id).lean())!;
        const events = await auditModel
          .find({ resourceId: id, action: 'SUPPORT_CONTEXT_READ' })
          .lean();
        expect({
          status: response.status,
          ...fault.counts,
          durableRevision: row.revision,
          durableReadAudits: events.length,
        }).toEqual({
          status: 503,
          businessCallbacks: 1,
          commitCalls: 1,
          durableRevision: before.revision + 1,
          durableReadAudits: 1,
        });
        expect(response.body).toMatchObject({
          code: 'SUPPORT_CONTEXT_OUTCOME_UNCONFIRMED',
          details: [{ contextId: id, mutationCommitted: 'unknown', retrySafe: false }],
        });
        expect(events[0]).toMatchObject({
          actorUserId: new Types.ObjectId(supportUserId),
          organizationId: new Types.ObjectId(supportOrganizationId),
          resourceType: 'SUPPORT_CONTEXT',
          resourceId: id,
          metadata: {
            originalSessionId: supportSessionId,
            operation: 'CONTEXT_STATUS',
            mode: 'READ_ONLY',
          },
        });
        expect(row.lastActivityAt).toEqual(new Date(control.time));
        expect(row.expiresAt).toEqual(before.expiresAt);
        // Read-only reconciliation by the original identity; do not submit another activity.
        const reconciled = await model
          .findOne({
            _id: response.body.details[0].contextId,
            actorUserId: supportUserId,
            originalSessionId: supportSessionId,
            organizationId: supportOrganizationId,
          })
          .lean();
        expect(reconciled!.revision).toBe(before.revision + 1);
        expect(fault.counts.businessCallbacks).toBe(1);
      } finally {
        fault.restore();
      }
    },
  );

  it('keeps a committed ENTER unconfirmed after mixed-label code 50 without replay', async () => {
    const fault = injectCommitAcknowledgementLoss(
      () =>
        new mongo.MongoServerError({
          message: 'TEST ENTER commit acknowledgement loss',
          code: 50,
          errorLabels: ['UnknownTransactionCommitResult', 'TransientTransactionError'],
        }),
    );
    try {
      const response = await call('post', contexts, {});
      expect({ status: response.status, ...fault.counts }).toEqual({
        status: 503,
        businessCallbacks: 1,
        commitCalls: 1,
      });
      expect(response.body.code).toBe('SUPPORT_CONTEXT_OUTCOME_UNCONFIRMED');
      const id = response.body.details[0].contextId;
      expect(await model.countDocuments()).toBe(1);
      const row = (await model.findById(id).lean())!;
      expect(row).toMatchObject({
        state: 'ACTIVE',
        revision: 1,
        actorUserId: new Types.ObjectId(supportUserId),
        originalSessionId: new Types.ObjectId(supportSessionId),
        organizationId: new Types.ObjectId(supportOrganizationId),
      });
      expect(
        await auditModel.countDocuments({ resourceId: id, action: 'SUPPORT_CONTEXT_ENTERED' }),
      ).toBe(1);
    } finally {
      fault.restore();
    }
  });

  it('keeps a committed EXIT unconfirmed after mixed-label code 50 without replay', async () => {
    const id = await enter();
    const fault = injectCommitAcknowledgementLoss(
      () =>
        new mongo.MongoServerError({
          message: 'TEST EXIT commit acknowledgement loss',
          code: 50,
          errorLabels: ['UnknownTransactionCommitResult', 'TransientTransactionError'],
        }),
    );
    try {
      const response = await exit(id);
      expect({ status: response.status, ...fault.counts }).toEqual({
        status: 503,
        businessCallbacks: 1,
        commitCalls: 1,
      });
      expect(response.body).toMatchObject({
        code: 'SUPPORT_CONTEXT_OUTCOME_UNCONFIRMED',
        details: [{ contextId: id, mutationCommitted: 'unknown', retrySafe: false }],
      });
      expect((await model.findById(id).lean())!).toMatchObject({ state: 'EXITED', revision: 2 });
      expect(
        await auditModel.countDocuments({ resourceId: id, action: 'SUPPORT_CONTEXT_EXITED' }),
      ).toBe(1);
    } finally {
      fault.restore();
    }
  });
});
