import { Global, INestApplication, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest');
import { AdminModule } from '../src/modules/admin/admin.module';
import { PlatformAdminService } from '../src/modules/admin/application/platform-admin.service';
import { PlatformAdminAccessService } from '../src/modules/admin/application/platform-admin-access.service';
import { PlatformAdminAuthorizationGuard } from '../src/modules/admin/presentation/platform-admin-authorization.guard';
import { PlatformAdminController } from '../src/modules/admin/presentation/platform-admin.controller';
import { RequireCurrentSessionService } from '../src/modules/auth/application/require-current-session.service';
import { SessionRepository } from '../src/modules/auth/domain/session.repository';
import { UserRepository } from '../src/modules/users/domain/user.repository';
import { EMAIL_PORT } from '../src/modules/auth/domain/email.port';
import { AUDIT_REPOSITORY } from '../src/modules/audit/domain/audit.repository';
import {
  IRbacRepository,
  IRbacUser,
  RBAC_REPOSITORY,
} from '../src/modules/rbac/domain/rbac.repository.interface';
import { EffectivePermissionsService } from '../src/modules/rbac/application/effective-permissions.service';
import { RbacSeedService } from '../src/modules/rbac/application/rbac-seed.service';
import { PERMISSIONS_KEY } from '../src/shared/security/require-permissions.decorator';
import { ApiExceptionFilter } from '../src/shared/errors/api-exception.filter';
import { UsersController } from '../src/modules/users/presentation/users.controller';
import { UpdateUserStatusService } from '../src/modules/users/application/update-user-status.service';
import { OnboardUserService } from '../src/modules/users/application/onboard-user.service';
import { RbacModule } from '../src/modules/rbac/rbac.module';
import { ProjectsController } from '../src/modules/projects/presentation/projects.controller';
import { ProjectService } from '../src/modules/projects/application/project.service';
import { ProjectStaffAllocationService } from '../src/modules/projects/application/project-staff-allocation.service';
import { ProjectRepository } from '../src/modules/projects/domain/project.types';
import { OrganizationContextService } from '../src/modules/organizations/application/organization-context.service';
import { OrganizationAuthorizationService } from '../src/modules/organizations/application/organization-authorization.service';
import { OrganizationRepository } from '../src/modules/organizations/domain/organization.repository';

const actorId = '111111111111111111111111';
const sessionId = '222222222222222222222222';
const targetId = '333333333333333333333333';
const otherId = '444444444444444444444444';
const secret = 'isolated-platform-admin-test-key';
const routeCases = [
  ['get', 'organizations', 'organizations.view', 'listOrganizations'],
  ['get', `organizations/${targetId}`, 'organizations.view', 'getOrganizationDetails'],
  ['post', 'organizations/enterprise', 'organizations.manage', 'createEnterprise'],
  ['patch', `organizations/${targetId}/engagement`, 'organizations.manage', 'updateEngagement'],
  ['get', 'revenue/summary', 'revenue.view', 'getRevenueSummary'],
  ['get', 'engagement-types', 'engagement-types.manage', 'listEngagementTypes'],
  ['post', 'engagement-types', 'engagement-types.manage', 'createEngagementType'],
  ['patch', `engagement-types/${targetId}`, 'engagement-types.manage', 'editEngagementType'],
  ['post', `users/${targetId}/lock`, 'users.lock', 'lockUser'],
  ['post', `users/${targetId}/unlock`, 'users.lock', 'unlockUser'],
  [
    'get',
    `users/${targetId}/offboarding-summary`,
    'users.offboard.review',
    'getOffboardingSummary',
  ],
  ['post', `users/${targetId}/offboard`, 'users.offboard', 'offboardUser'],
  ['post', 'resources/transfer', 'resources.transfer', 'transferResource'],
  ['get', 'audit-logs', 'audit.view', 'listAuditLogs'],
  ['get', 'audit-logs/export', 'audit.view', 'exportAuditLogs'],
  ['get', 'audit-logs/export/pdf', 'audit.view', 'exportAuditLogsPdf'],
] as const;
const catalog = [
  ...new Set([...routeCases.map((c) => c[2]), 'resources.transfer.confirm', 'users.manage']),
];

describe('global platform admin policy', () => {
  const user = (): IRbacUser => ({
    id: actorId,
    email: 'admin@example.test',
    fullName: 'Admin',
    isPlatformAdmin: true,
    isActive: true,
    isLocked: false,
  });
  it.each(['missing', 'ordinary', 'inactive', 'locked', 'different-account'])(
    'denies %s persisted authority despite all permissions',
    async (state) => {
      const account = user();
      if (state === 'ordinary') account.isPlatformAdmin = false;
      if (state === 'inactive') account.isActive = false;
      if (state === 'locked') account.isLocked = true;
      if (state === 'different-account') account.id = otherId;
      const rbac = {
        findUserById: jest.fn().mockResolvedValue(state === 'missing' ? null : account),
      };
      const permissions = { getEffectivePermissions: jest.fn().mockResolvedValue(catalog) };
      const access = new PlatformAdminAccessService(
        rbac as unknown as IRbacRepository,
        permissions as unknown as EffectivePermissionsService,
      );
      await expect(access.authorize(actorId, ['organizations.view'])).rejects.toMatchObject({
        status: 403,
      });
      expect(permissions.getEffectivePermissions).not.toHaveBeenCalled();
    },
  );
  it('requires every operation permission, even for a persisted administrator', async () => {
    const access = new PlatformAdminAccessService(
      { findUserById: async () => user() } as unknown as IRbacRepository,
      {
        getEffectivePermissions: async () => ['resources.transfer'],
      } as unknown as EffectivePermissionsService,
    );
    await expect(
      access.authorize(actorId, ['resources.transfer', 'resources.transfer.confirm']),
    ).rejects.toMatchObject({ status: 403 });
    await expect(access.authorize(actorId, ['resources.transfer'])).resolves.toBeUndefined();
  });
  it('fails closed when a new handler lacks an explicit policy', async () => {
    const access = new PlatformAdminAccessService(
      {} as IRbacRepository,
      {} as EffectivePermissionsService,
    );
    await expect(access.authorize(actorId, [])).rejects.toMatchObject({ status: 503 });
    const guard = new PlatformAdminAuthorizationGuard(new Reflector(), access);
    await expect(
      guard.canActivate({
        getHandler: () => () => {},
        switchToHttp: () => ({ getRequest: () => ({ user: { userId: actorId } }) }),
      } as never),
    ).rejects.toMatchObject({ status: 503 });
  });
});

describe('real AdminModule authorization HTTP boundary', () => {
  let app: INestApplication;
  const jwt = new JwtService({ secret });
  let account: IRbacUser;
  let session: {
    id: string;
    userId: string;
    accessVersion: string;
    expiresAt: Date;
    revokedAt?: Date;
  };
  const users = { findById: jest.fn(), updateStatus: jest.fn() };
  const sessions = { findActiveByUserId: jest.fn() };
  const rbac = {
    findUserById: jest.fn(),
    findPermissions: jest.fn(),
    findUserRoles: jest.fn(),
    findRolePermissionsByRoleIds: jest.fn(),
  };
  const audit = { append: jest.fn() };
  const email = { send: jest.fn() };
  const projectRepository = {
    assignTeamLead: jest.fn(),
    findAll: jest.fn(),
    findByAssignedStaff: jest.fn().mockResolvedValue([]),
    findByAssignedTeamLead: jest.fn().mockResolvedValue([]),
  };
  const organizationRepository = { findFirstForMember: jest.fn(), findForMember: jest.fn() };
  // Actual module, guards, RBAC resolver, current-session service and business
  // services. Only database/email ports and bootstrap side effects are fixtures.
  const modelNames = [
    'Organization',
    'User',
    'UserSession',
    'EngagementType',
    'Project',
    'ConversionJob',
    'AuditLog',
    'Role',
    'Permission',
    'UserRole',
    'RolePermission',
    'MenuItem',
    'MenuItemPermission',
    'TemporaryRole',
  ];
  const models = Object.fromEntries(
    modelNames.map((name) => [
      name,
      {
        find: jest.fn(),
        findById: jest.fn(),
        findOne: jest.fn(),
        countDocuments: jest.fn(),
        create: jest.fn(),
        findByIdAndUpdate: jest.fn(),
        updateMany: jest.fn(),
      },
    ]),
  );
  const save = jest.fn();
  const query = (value: unknown) => {
    const chain = {
      sort: () => chain,
      select: () => chain,
      populate: () => chain,
      skip: () => chain,
      limit: () => chain,
      exec: async () => value,
    };
    return chain;
  };
  const org = () => ({
    _id: targetId,
    id: targetId,
    name: 'Authorized Customer',
    type: 'ENTERPRISE',
    status: 'ACTIVE',
    members: [{ userId: otherId, role: 'MEMBER' }],
    limits: {},
    createdAt: new Date(0),
    updatedAt: new Date(0),
    save,
  });
  const selectedUser = () => ({
    _id: targetId,
    id: targetId,
    fullName: 'Selected User',
    email: 'target@example.test',
    isActive: true,
    isLocked: false,
    save,
  });
  const noBusinessReads = () => {
    for (const model of Object.values(models))
      for (const method of Object.values(model)) expect(method).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(audit.append).not.toHaveBeenCalled();
    expect(email.send).not.toHaveBeenCalled();
  };
  const token = (claims: Record<string, unknown> = {}) =>
    jwt.sign({
      sub: actorId,
      sid: sessionId,
      sv: 'current',
      email: 'actor@example.test',
      isPlatformAdmin: false,
      ...claims,
    });
  const call = (
    method: string,
    path: string,
    claims: Record<string, unknown> = {},
    body: Record<string, unknown> = {},
  ) =>
    request(app.getHttpServer())
      [method](`/api/v1/admin/${path}`)
      .auth(token(claims), { type: 'bearer' })
      .set('x-organization-id', otherId)
      .set('x-role', 'ADMIN')
      .send(body);

  @Global()
  @Module({
    providers: [
      { provide: JwtService, useValue: jwt },
      { provide: ConfigService, useValue: { getOrThrow: () => secret } },
      { provide: AUDIT_REPOSITORY, useValue: audit },
      {
        provide: RequireCurrentSessionService,
        useValue: new RequireCurrentSessionService(
          sessions as unknown as SessionRepository,
          users as unknown as UserRepository,
        ),
      },
    ],
    exports: [JwtService, ConfigService, AUDIT_REPOSITORY, RequireCurrentSessionService],
  })
  class AuthenticationFixtureModule {}

  beforeAll(async () => {
    let builder = Test.createTestingModule({
      imports: [AuthenticationFixtureModule, AdminModule, RbacModule],
      controllers: [UsersController, ProjectsController],
      providers: [
        { provide: OnboardUserService, useValue: {} },
        // ProjectsController also serves staff allocation (UC-86); these tests never call it.
        { provide: ProjectStaffAllocationService, useValue: {} },
        {
          provide: ProjectService,
          useValue: new ProjectService(
            projectRepository as unknown as ProjectRepository,
            new OrganizationContextService(
              organizationRepository as unknown as OrganizationRepository,
            ),
            new OrganizationAuthorizationService(),
            audit,
          ),
        },
        {
          provide: UpdateUserStatusService,
          useValue: new UpdateUserStatusService(users as unknown as UserRepository),
        },
      ],
    })
      .overrideProvider(RBAC_REPOSITORY)
      .useValue(rbac)
      .overrideProvider(RbacSeedService)
      .useValue({})
      .overrideProvider(EMAIL_PORT)
      .useValue(email);
    for (const name of modelNames)
      builder = builder.overrideProvider(getModelToken(name)).useValue(models[name]);
    const module = await builder.compile();
    app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
  });
  afterAll(async () => app?.close());
  beforeEach(() => {
    jest.resetAllMocks();
    account = {
      id: actorId,
      email: 'actor@example.test',
      fullName: 'Actor',
      isPlatformAdmin: true,
      isActive: true,
      isLocked: false,
    };
    session = {
      id: sessionId,
      userId: actorId,
      accessVersion: 'current',
      expiresAt: new Date(Date.now() + 60000),
    };
    users.findById.mockImplementation(async () => ({ ...account, mustChangePassword: false }));
    sessions.findActiveByUserId.mockImplementation(async () => [session]);
    rbac.findUserById.mockImplementation(async () => account);
    rbac.findPermissions.mockResolvedValue(catalog.map((key) => ({ key })));
    rbac.findUserRoles.mockResolvedValue(['INTERNAL_SUPPORT', 'TEAM_LEAD', 'ADMIN']);
    rbac.findRolePermissionsByRoleIds.mockResolvedValue(catalog);
    save.mockResolvedValue(undefined);
    projectRepository.assignTeamLead.mockResolvedValue({ id: targetId, organizationId: otherId });
    projectRepository.findAll.mockResolvedValue([]);
    organizationRepository.findFirstForMember.mockResolvedValue({
      id: targetId,
      members: [{ userId: actorId, role: 'MEMBER' }],
    });
    audit.append.mockResolvedValue(undefined);
    email.send.mockResolvedValue(undefined);
    for (const model of Object.values(models)) {
      model.find.mockImplementation(() => query([]));
      model.findById.mockImplementation(() => query(selectedUser()));
      model.findOne.mockImplementation(() => query(null));
      model.countDocuments.mockResolvedValue(0);
      model.create.mockResolvedValue({ _id: targetId, id: targetId, name: 'Created' });
      model.findByIdAndUpdate.mockImplementation(() => query({ id: targetId, name: 'Edited' }));
      model.updateMany.mockResolvedValue({ modifiedCount: 1 });
    }
    models.Organization.find.mockImplementation(() => query([org()]));
    models.Organization.findById.mockImplementation(() => query(org()));
    models.Project.findById.mockImplementation(() =>
      query({ _id: targetId, id: targetId, organizationId: otherId, createdBy: actorId, save }),
    );
    models.EngagementType.find.mockImplementation(() =>
      query([{ id: targetId, name: 'Existing' }]),
    );
  });

  it.each(routeCases)(
    'permits persisted admin with current catalog permission: %s %s',
    async (method, path) => {
      const body = {
        name: 'Created',
        contactEmail: 'new@example.test',
        status: 'SUSPENDED',
        projectId: targetId,
        newAssigneeId: otherId,
      };
      const response = await call(method, path, {}, body);
      expect(response.status).toBe(method === 'post' ? 201 : 200);
      expect(rbac.findPermissions).toHaveBeenCalled();
    },
  );
  describe.each(['ordinary member', 'INTERNAL_SUPPORT', 'TEAM_LEAD'])(
    '%s with even all role permissions',
    (role) => {
      it.each(routeCases)(
        'denies global %s %s before sensitive persistence',
        async (method, path) => {
          account.isPlatformAdmin = false;
          const response = await call(
            method,
            path,
            { isPlatformAdmin: true, role, effectivePermissions: catalog },
            {
              isPlatformAdmin: true,
              role: 'ADMIN',
              permissions: catalog,
              projectId: targetId,
              newAssigneeId: otherId,
              transferToUserId: otherId,
            },
          );
          expect(response.status).toBe(403);
          noBusinessReads();
          expect(rbac.findPermissions).not.toHaveBeenCalled();
        },
      );
    },
  );
  it.each(routeCases)(
    'denies admin when required permission is absent: %s %s',
    async (method, path, permission) => {
      rbac.findPermissions.mockResolvedValue(
        catalog.filter((key) => key !== permission).map((key) => ({ key })),
      );
      expect((await call(method, path)).status).toBe(403);
      noBusinessReads();
    },
  );
  it.each(['resources.transfer', 'resources.transfer.confirm'])(
    'requires %s for direct and embedded transfer',
    async (permission) => {
      rbac.findPermissions.mockResolvedValue(
        catalog.filter((key) => key !== permission).map((key) => ({ key })),
      );
      expect(
        (
          await call(
            'post',
            'resources/transfer',
            {},
            { projectId: targetId, newAssigneeId: otherId },
          )
        ).status,
      ).toBe(403);
      expect(
        (await call('post', `users/${targetId}/offboard`, {}, { transferToUserId: otherId }))
          .status,
      ).toBe(403);
      noBusinessReads();
      // Plain offboarding does not secretly require a transfer capability.
      expect((await call('post', `users/${targetId}/offboard`)).status).toBe(201);
    },
  );
  it('requires users.offboard as well as both transfer permissions for embedded transfer', async () => {
    rbac.findPermissions.mockResolvedValue(
      catalog.filter((key) => key !== 'users.offboard').map((key) => ({ key })),
    );
    expect(
      (await call('post', `users/${targetId}/offboard`, {}, { transferToUserId: otherId })).status,
    ).toBe(403);
    noBusinessReads();
  });
  it('allows embedded transfer only with all three permissions', async () => {
    expect(
      (await call('post', `users/${targetId}/offboard`, {}, { transferToUserId: otherId })).status,
    ).toBe(201);
    expect(models.Project.updateMany).toHaveBeenCalled();
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: actorId, action: 'RESOURCE_OWNERSHIP_TRANSFERRED' }),
    );
  });
  it.each([targetId, otherId, 'bad-id'])(
    'does not disclose any tenant/member/billing/engagement data for target %s to a member',
    async (id) => {
      account.isPlatformAdmin = false;
      expect((await call('get', `organizations/${id}`)).status).toBe(403);
      expect((await call('patch', `organizations/${id}/engagement`)).status).toBe(403);
      noBusinessReads();
    },
  );
  it('retains admin reads for inactive organisations and 404 for missing organisations', async () => {
    models.Organization.findById.mockImplementation(() => query({ ...org(), status: 'SUSPENDED' }));
    expect((await call('get', `organizations/${targetId}`)).body.status).toBe('SUSPENDED');
    models.Organization.findById.mockImplementation(() => query(null));
    expect((await call('get', `organizations/${otherId}`)).status).toBe(404);
  });
  it('uses fresh stored admin status on subsequent requests rather than signed admin claims', async () => {
    expect((await call('get', 'organizations', { isPlatformAdmin: true })).status).toBe(200);
    models.Organization.find.mockClear();
    account.isPlatformAdmin = false;
    expect((await call('get', 'organizations', { isPlatformAdmin: true })).status).toBe(403);
    expect(models.Organization.find).not.toHaveBeenCalled();
  });
  it.each(['account', 'permissions'])(
    'returns secret-free 503 when %s authority fails',
    async (which) => {
      rbac[which === 'account' ? 'findUserById' : 'findPermissions'].mockRejectedValue(
        new Error('private driver credentials'),
      );
      const response = await call('get', 'organizations');
      expect(response.status).toBe(503);
      expect(response.body.code).toBe('PLATFORM_ADMIN_AUTHORIZATION_UNAVAILABLE');
      expect(JSON.stringify(response.body)).not.toContain('private');
      noBusinessReads();
    },
  );
  it.each([
    'missing JWT',
    'invalid JWT',
    'expired session',
    'revoked session',
    'inactive account',
    'locked account',
    'stale session',
  ])('retains 401 for %s', async (state) => {
    if (state === 'expired session') session.expiresAt = new Date(0);
    if (state === 'revoked session') session.revokedAt = new Date();
    if (state === 'inactive account') account.isActive = false;
    if (state === 'locked account') account.isLocked = true;
    if (state === 'stale session') session.accessVersion = 'rotated';
    const req = request(app.getHttpServer()).get('/api/v1/admin/organizations');
    if (state !== 'missing JWT')
      req.auth(state === 'invalid JWT' ? 'invalid' : token(), { type: 'bearer' });
    expect((await req).status).toBe(401);
    expect(rbac.findUserById).not.toHaveBeenCalled();
    noBusinessReads();
  });
  it('retains unavailable ordinary-session authority 503 before authorization', async () => {
    sessions.findActiveByUserId.mockRejectedValue(new Error('private session DB'));
    expect((await call('get', 'organizations')).body.code).toBe('SESSION_ASSURANCE_UNAVAILABLE');
    expect(rbac.findUserById).not.toHaveBeenCalled();
    noBusinessReads();
  });
  it.each(routeCases)(
    'denies a locked persisted admin with signed claims on %s %s',
    async (method, path) => {
      account.isLocked = true;
      expect((await call(method, path, { isPlatformAdmin: true })).status).toBe(401);
      expect(rbac.findUserById).not.toHaveBeenCalled();
      noBusinessReads();
    },
  );
  it('keeps impersonation unavailable without requiring admin/RBAC availability', async () => {
    account.isPlatformAdmin = false;
    rbac.findUserById.mockRejectedValue(new Error('unavailable'));
    const response = await call('post', `organizations/${targetId}/impersonate`, {
      isPlatformAdmin: true,
    });
    expect(response.status).toBe(503);
    expect(response.body.code).toBe('SUPPORT_IMPERSONATION_UNAVAILABLE');
    expect(rbac.findUserById).not.toHaveBeenCalled();
    noBusinessReads();
  });
  describe('alternate global user-status lifecycle route', () => {
    const status = () =>
      request(app.getHttpServer())
        .patch(`/api/v1/users/${targetId}/status`)
        .auth(
          token({ isPlatformAdmin: true, role: 'ADMIN', effectivePermissions: ['users.manage'] }),
          { type: 'bearer' },
        )
        .send({ isActive: false });
    it.each(['TEAM_LEAD', 'INTERNAL_SUPPORT', 'ordinary member'])(
      'denies %s despite users.manage and signed admin claims',
      async () => {
        account.isPlatformAdmin = false;
        expect((await status()).status).toBe(403);
        expect(users.updateStatus).not.toHaveBeenCalled();
        noBusinessReads();
      },
    );
    it('preserves authorized admin deactivation', async () => {
      expect((await status()).status).toBe(200);
      expect(users.updateStatus).toHaveBeenCalledWith(targetId, false);
    });
    it('denies missing users.manage before target mutation', async () => {
      rbac.findPermissions.mockResolvedValue([]);
      expect((await status()).status).toBe(403);
      expect(users.updateStatus).not.toHaveBeenCalled();
    });
    it('retains current-session validation before global status authorization', async () => {
      session.revokedAt = new Date();
      expect((await status()).status).toBe(401);
      expect(users.updateStatus).not.toHaveBeenCalled();
    });
    it('returns 503 when mandatory status authorization is unavailable', async () => {
      rbac.findUserById.mockRejectedValue(new Error('private driver credentials'));
      const response = await status();
      expect(response.status).toBe(503);
      expect(response.body.code).toBe('PLATFORM_ADMIN_AUTHORIZATION_UNAVAILABLE');
      expect(users.updateStatus).not.toHaveBeenCalled();
    });
  });
  describe('alternate global project reassignment route', () => {
    const assign = (id = targetId) =>
      request(app.getHttpServer())
        .post(`/api/v1/projects/${id}/assign-team-lead`)
        .auth(token({ isPlatformAdmin: true }), { type: 'bearer' })
        .send({ teamLeadId: otherId });
    it.each([targetId, otherId, 'invalid-id'])(
      'denies team-lead reassignment of arbitrary project %s',
      async (id) => {
        account.isPlatformAdmin = false;
        expect((await assign(id)).status).toBe(403);
        expect(projectRepository.assignTeamLead).not.toHaveBeenCalled();
        expect(audit.append).not.toHaveBeenCalled();
      },
    );
    it.each(['organizations.manage', 'resources.transfer', 'resources.transfer.confirm'])(
      'requires %s for global reassignment',
      async (permission) => {
        rbac.findPermissions.mockResolvedValue(
          catalog.filter((key) => key !== permission).map((key) => ({ key })),
        );
        expect((await assign()).status).toBe(403);
        expect(projectRepository.assignTeamLead).not.toHaveBeenCalled();
      },
    );
    it('preserves permitted administrator assignment', async () => {
      expect((await assign()).status).toBe(201);
      expect(projectRepository.assignTeamLead).toHaveBeenCalledWith(targetId, otherId);
    });
    it('preserves ordinary membership-scoped project listing', async () => {
      account.isPlatformAdmin = false;
      const response = await request(app.getHttpServer())
        .get('/api/v1/projects')
        .auth(token(), { type: 'bearer' });
      expect(response.status).toBe(200);
      expect(organizationRepository.findFirstForMember).toHaveBeenCalledWith(actorId);
      expect(projectRepository.findAll).toHaveBeenCalledWith(targetId);
      expect(rbac.findUserById).not.toHaveBeenCalled();
    });
  });
  it('covers every registered handler with an explicit permission or the single disabled exception', () => {
    const prototype = PlatformAdminController.prototype;
    const methods = Object.getOwnPropertyNames(prototype).filter((name) => name !== 'constructor');
    expect(methods.sort()).toEqual([...routeCases.map((c) => c[3]), 'impersonate'].sort());
    for (const [, , permission, name] of routeCases)
      expect(Reflect.getMetadata(PERMISSIONS_KEY, prototype[name])).toContain(permission);
    expect(app.get(PlatformAdminService)).toBeInstanceOf(PlatformAdminService);
  });
});
