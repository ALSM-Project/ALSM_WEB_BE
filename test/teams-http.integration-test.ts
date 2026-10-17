/** Opt-in real HTTP/Mongo tests. No .env load, production DB, AI or converter execution. */
import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Connection, createConnection, Types } from 'mongoose';
import { Team, TeamSchema } from '../src/modules/teams/infrastructure/team.schema';
import { MongoTeamRepository } from '../src/modules/teams/infrastructure/mongo-team.repository';
import { TeamAccessService } from '../src/modules/teams/application/team-access.service';
import { SaveTeamService } from '../src/modules/teams/application/save-team.service';
import { ListManagedTeamsService } from '../src/modules/teams/application/list-managed-teams.service';
import { TeamsController } from '../src/modules/teams/presentation/teams.controller';
import { TeamKind, TeamRecord } from '../src/modules/teams/domain/team.types';
import {
  Organization,
  OrganizationSchema,
} from '../src/modules/organizations/infrastructure/organization.schema';
import { MongoOrganizationRepository } from '../src/modules/organizations/infrastructure/mongo-organization.repository';
import { OrganizationContextService } from '../src/modules/organizations/application/organization-context.service';
import { OrganizationAuthorizationService } from '../src/modules/organizations/application/organization-authorization.service';
import {
  OrganizationRole,
  OrganizationType,
} from '../src/modules/organizations/domain/organization.types';
import { User, UserSchema } from '../src/modules/users/infrastructure/user.schema';
import { MongoUserRepository } from '../src/modules/users/infrastructure/mongo-user.repository';
import { Project, ProjectSchema } from '../src/modules/projects/infrastructure/project.schema';
import { MongoProjectRepository } from '../src/modules/projects/infrastructure/mongo-project.repository';
import { AuditLog, AuditLogSchema } from '../src/modules/audit/infrastructure/audit-log.schema';
import { MongoAuditRepository } from '../src/modules/audit/infrastructure/mongo-audit.repository';
import { Role, RoleSchema } from '../src/modules/rbac/infrastructure/schemas/role.schema';
import {
  Permission,
  PermissionSchema,
} from '../src/modules/rbac/infrastructure/schemas/permission.schema';
import {
  UserRole,
  UserRoleSchema,
} from '../src/modules/rbac/infrastructure/schemas/user-role.schema';
import {
  RolePermission,
  RolePermissionSchema,
} from '../src/modules/rbac/infrastructure/schemas/role-permission.schema';
import { MongoRbacRepository } from '../src/modules/rbac/infrastructure/persistence/mongo-rbac.repository';
import { EffectivePermissionsService } from '../src/modules/rbac/application/effective-permissions.service';
import { JwtAuthGuard } from '../src/shared/security/jwt-auth.guard';
import { GetTeamAdministrationService } from '../src/modules/teams/application/get-team-administration.service';
import { GetSalesTeamPerformanceService } from '../src/modules/teams/application/get-sales-team-performance.service';
import { TeamReportsController } from '../src/modules/teams/presentation/team-reports.controller';

jest.setTimeout(30000);
const owned = process.env.ALSM_TEAM_HTTP_TEST === 'owned-local-only' ? describe : describe.skip;
function verifyOwnedMongo() {
  const info = JSON.parse(
    execFileSync('docker', ['inspect', 'alsm-emergency-20261017-mongo'], {
      encoding: 'utf8',
      windowsHide: true,
    }),
  ) as {
    Config: { Labels: Record<string, string> };
    State: { Running: boolean };
    NetworkSettings: { Ports: Record<string, { HostIp: string; HostPort: string }[]> };
  }[];
  expect(info[0].Config.Labels['alsm.owner']).toBe('emergency-20261017');
  expect(info[0].State.Running).toBe(true);
  expect(info[0].NetworkSettings.Ports['27017/tcp']).toEqual([
    { HostIp: '127.0.0.1', HostPort: '27117' },
  ]);
}

owned('Teams actual HTTP + Mongo + persisted RBAC', () => {
  const runId = randomUUID();
  const database = `alsm_team_http_${runId.replace(/-/g, '')}`;
  const owner = String(new Types.ObjectId()),
    manager = String(new Types.ObjectId()),
    other = String(new Types.ObjectId()),
    member = String(new Types.ObjectId()),
    foreign = String(new Types.ObjectId());
  let organizationId: string, foreignOrganizationId: string;
  let connection: Connection, app: INestApplication, url: string, jwt: JwtService, team: TeamRecord;
  let teams: MongoTeamRepository;
  let access: TeamAccessService;
  let projects: MongoProjectRepository;
  let users: MongoUserRepository;
  let audit: MongoAuditRepository;
  async function request(
    method: string,
    route: string,
    actor = owner,
    body?: unknown,
    organization = organizationId,
  ) {
    const response = await fetch(url + route, {
      method,
      headers: {
        Authorization: `Bearer ${jwt.sign({ sub: actor, email: 'fixture@example.invalid', isPlatformAdmin: false })}`,
        'Content-Type': 'application/json',
        'x-organization-id': organization,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }
  const input = () => ({
    name: 'Owned Sales',
    kind: TeamKind.SALES,
    memberIds: [member],
    managerIds: [manager],
    projectAssignments: [],
    expectedRevision: 0,
  });

  beforeAll(async () => {
    verifyOwnedMongo();
    connection = await createConnection(`mongodb://127.0.0.1:27117/${database}`).asPromise();
    expect((await connection.db!.listCollections().toArray()).length).toBe(0);
    await connection.collection('_team_test_owner').insertOne({ runId });
    const userModel = connection.model(User.name, UserSchema);
    await userModel.create(
      [owner, manager, other, member, foreign].map((_id) => ({
        _id,
        email: `${_id}@example.invalid`,
        fullName: `Fixture ${_id}`,
        isActive: true,
      })),
    );
    users = new MongoUserRepository(userModel);
    const organizations = new MongoOrganizationRepository(
      connection.model(Organization.name, OrganizationSchema),
    );
    organizationId = (
      await organizations.create({
        name: 'Owned Org',
        type: OrganizationType.INTERNAL,
        members: [owner, manager, other, member].map((userId) => ({
          userId,
          role: userId === owner ? OrganizationRole.OWNER : OrganizationRole.MEMBER,
        })),
      })
    ).id;
    foreignOrganizationId = (
      await organizations.create({
        name: 'Foreign Org',
        type: OrganizationType.INTERNAL,
        members: [{ userId: foreign, role: OrganizationRole.OWNER }],
      })
    ).id;
    const rbac = new MongoRbacRepository(
      connection.model(Role.name, RoleSchema) as unknown as ConstructorParameters<
        typeof MongoRbacRepository
      >[0],
      connection.model(Permission.name, PermissionSchema) as unknown as ConstructorParameters<
        typeof MongoRbacRepository
      >[1],
      connection.model(
        RolePermission.name,
        RolePermissionSchema,
      ) as unknown as ConstructorParameters<typeof MongoRbacRepository>[2],
      connection.model(UserRole.name, UserRoleSchema) as unknown as ConstructorParameters<
        typeof MongoRbacRepository
      >[3],
      userModel as unknown as ConstructorParameters<typeof MongoRbacRepository>[4],
    );
    await rbac.createRole({
      id: 'TEAM_TEST_ADMIN',
      name: 'Fixture admin',
      description: 'Owned test only',
      isSystem: false,
    });
    await rbac.createPermission({
      key: 'users.manage',
      label: 'Fixture',
      group: 'users',
      description: 'Owned test only',
    });
    await rbac.updateRolePermissions('TEAM_TEST_ADMIN', ['users.manage']);
    await rbac.updateUserRoles(owner, ['TEAM_TEST_ADMIN']);
    const permissions = new EffectivePermissionsService(rbac);
    teams = new MongoTeamRepository(connection.model(Team.name, TeamSchema));
    await connection.model(Team.name).init();
    projects = new MongoProjectRepository(connection.model(Project.name, ProjectSchema));
    audit = new MongoAuditRepository(connection.model(AuditLog.name, AuditLogSchema));
    access = new TeamAccessService(
      new OrganizationContextService(organizations),
      new OrganizationAuthorizationService(),
      users,
      permissions,
      teams,
    );
    const save = new SaveTeamService(access, teams, users, projects, audit);
    const list = new ListManagedTeamsService(access, teams);
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'owned-team-http-test-key' })],
      controllers: [TeamsController, TeamReportsController],
      providers: [
        {
          provide: GetSalesTeamPerformanceService,
          useValue: new GetSalesTeamPerformanceService(access, users),
        },
        {
          provide: GetTeamAdministrationService,
          useValue: new GetTeamAdministrationService(access, teams),
        },
        JwtAuthGuard,
        {
          provide: ConfigService,
          useValue: new ConfigService({ JWT_ACCESS_SECRET: 'owned-team-http-test-key' }),
        },
        { provide: SaveTeamService, useValue: save },
        { provide: ListManagedTeamsService, useValue: list },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.listen(0, '127.0.0.1');
    jwt = module.get(JwtService);
    url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
  });
  afterAll(async () => {
    await app?.close();
    if (connection) {
      verifyOwnedMongo();
      expect(connection.host).toBe('127.0.0.1');
      expect(connection.port).toBe(27117);
      expect(connection.name).toBe(database);
      expect(await connection.collection('_team_test_owner').findOne({ runId })).toBeTruthy();
      await connection.dropDatabase();
      await connection.close();
    }
  });

  it('persists explicit team membership, management scope and attributed audits', async () => {
    const result = await request('POST', '/teams', owner, input());
    expect(result.status).toBe(201);
    team = result.body as unknown as TeamRecord;
    expect(team.memberIds).toEqual([member]);
    expect(team.managerIds).toEqual([manager]);
    expect((await request('GET', `/teams/${team.id}/administration`)).body).toEqual(team);
    expect((await request('GET', `/teams/${team.id}/administration`, member)).status).toBe(403);
    const persisted = await connection.model<Team>(Team.name).findById(team.id).lean();
    expect(persisted?.changes).toEqual([
      expect.objectContaining({ actorUserId: owner, revision: 1 }),
    ]);
    expect(
      await connection.collection('audit_logs').countDocuments({
        organizationId: new Types.ObjectId(organizationId),
        action: 'TEAM_SAVED',
        actorUserId: new Types.ObjectId(owner),
      }),
    ).toBe(1);
  });
  it('denies ordinary-member administration, forged DTO fields and cross-organization writes', async () => {
    expect((await request('POST', '/teams', member, input())).status).toBe(403);
    expect(
      (await request('POST', '/teams', owner, { ...input(), actorUserId: owner })).status,
    ).toBe(400);
    expect((await request('POST', '/teams', owner, input(), foreignOrganizationId)).status).toBe(
      403,
    );
    expect(
      (await request('POST', '/teams', owner, { ...input(), memberIds: [foreign] })).status,
    ).toBe(400);
    expect(await connection.collection('teams').countDocuments()).toBe(1);
  });
  it('returns only explicitly managed teams, denies foreign context and never appoints organization members implicitly', async () => {
    expect((await request('GET', '/teams?kind=SALES', manager)).body).toEqual([
      expect.objectContaining({ id: team.id }),
    ]);
    expect((await request('GET', '/teams?kind=SALES', other)).body).toEqual([]);
    expect((await request('GET', '/teams?kind=SALES', member)).body).toEqual([]);
    expect((await request('GET', '/teams?kind=CONVERSION', manager)).body).toEqual([]);
    expect((await request('GET', '/teams?kind=SALES', foreign)).status).toBe(403);
    expect(
      (await request('GET', '/teams?kind=SALES', manager, undefined, foreignOrganizationId)).status,
    ).toBe(403);
  });
  it('enforces optimistic revisions, immutable type and immediate manager revocation on reload', async () => {
    const result = await request('PUT', `/teams/${team.id}`, owner, {
      ...input(),
      managerIds: [other],
      expectedRevision: 1,
    });
    expect(result.status).toBe(200);
    expect(
      (await request('PUT', `/teams/${team.id}`, owner, { ...input(), expectedRevision: 1 }))
        .status,
    ).toBe(409);
    expect(
      (
        await request('PUT', `/teams/${team.id}`, owner, {
          ...input(),
          kind: TeamKind.CONVERSION,
          expectedRevision: 2,
        })
      ).status,
    ).toBe(409);
    expect((await request('GET', '/teams?kind=SALES', manager)).body).toEqual([]);
    expect((await request('GET', '/teams?kind=SALES', other)).body).toEqual([
      expect.objectContaining({ revision: 2 }),
    ]);
  });
  it('serves a persisted salesperson roster but never invents sales values or converted statuses', async () => {
    const result = await request('GET', `/teams/${team.id}/performance?days=7`, other);
    expect(result.status).toBe(200);
    expect(result.body).toEqual(
      expect.objectContaining({
        team: expect.objectContaining({ id: team.id }),
        metrics: expect.objectContaining({
          leadCount: expect.objectContaining({ available: false }),
          conversionRate: expect.objectContaining({ available: false }),
          revenueGenerated: expect.objectContaining({ available: false }),
        }),
        members: [expect.objectContaining({ userId: member })],
      }),
    );
    expect(JSON.stringify(result.body)).not.toContain('"value":');
    expect((await request('GET', `/teams/${team.id}/performance?days=30`, other)).status).toBe(200);
    expect((await request('GET', `/teams/${team.id}/performance?days=8`, other)).status).toBe(400);
    expect((await request('GET', `/teams/${team.id}/performance?days=7`, manager)).status).toBe(
      404,
    );
    expect((await request('GET', `/teams/${team.id}/performance?days=7`, member)).status).toBe(404);
    expect((await request('GET', `/teams/${team.id}/performance?days=7`, foreign)).status).toBe(
      403,
    );
  });
});
