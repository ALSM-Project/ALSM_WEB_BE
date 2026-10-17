/** Opt-in real HTTP/Mongo tests. No .env load, production DB, AI or converter execution. */
import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ApiExceptionFilter } from '../src/shared/errors/api-exception.filter';
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
import {
  TeamJobAssignment,
  TeamJobAssignmentSchema,
} from '../src/modules/teams/infrastructure/team-job-assignment.schema';
import { MongoTeamJobAssignmentRepository } from '../src/modules/teams/infrastructure/mongo-team-job-assignment.repository';
import { AssignTeamJobService } from '../src/modules/teams/application/assign-team-job.service';
import { RevokeTeamJobService } from '../src/modules/teams/application/revoke-team-job.service';
import { ListTeamJobAssignmentsService } from '../src/modules/teams/application/list-team-job-assignments.service';
import { GetTeamWorkloadService } from '../src/modules/teams/application/get-team-workload.service';
import { TeamJobAssignmentsController } from '../src/modules/teams/presentation/team-job-assignments.controller';
import {
  ConversionJob,
  ConversionJobSchema,
} from '../src/modules/conversions/infrastructure/conversion-job.schema';
import { MongoConversionJobRepository } from '../src/modules/conversions/infrastructure/mongo-conversion-job.repository';
import { MongoConversionWorkloadReader } from '../src/modules/conversions/infrastructure/mongo-conversion-workload.reader';
import { ConversionType, ProjectStatus } from '../src/modules/projects/domain/project.types';
import { ConversionJobStatus } from '../src/modules/conversions/domain/conversion-job.types';

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
  let assignments: MongoTeamJobAssignmentRepository;
  let jobs: MongoConversionJobRepository;
  let reader: MongoConversionWorkloadReader;
  let conversionTeam: TeamRecord;
  let projectId: string;
  const jobIds: string[] = [];
  async function request(
    method: string,
    route: string,
    actor = owner,
    body?: unknown,
    organization = organizationId,
  ) {
    if (method === 'POST' && body && typeof body === 'object') {
      const payload = body;
      if (route === '/teams' && !('creationId' in payload))
        body = { ...body, creationId: new Types.ObjectId().toHexString() };
      if (route.endsWith('/job-assignments') && !('assignmentId' in payload))
        body = { ...payload, assignmentId: new Types.ObjectId().toHexString() };
    }
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
    assignments = new MongoTeamJobAssignmentRepository(
      connection.model(TeamJobAssignment.name, TeamJobAssignmentSchema),
    );
    await connection.model(TeamJobAssignment.name).init();
    const jobModel = connection.model(ConversionJob.name, ConversionJobSchema);
    jobs = new MongoConversionJobRepository(jobModel);
    reader = new MongoConversionWorkloadReader(jobModel);
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
      controllers: [TeamsController, TeamReportsController, TeamJobAssignmentsController],
      providers: [
        {
          provide: GetTeamWorkloadService,
          useValue: new GetTeamWorkloadService(access, assignments, reader, projects, users),
        },
        {
          provide: AssignTeamJobService,
          useValue: new AssignTeamJobService(
            access,
            teams,
            assignments,
            jobs,
            projects,
            users,
            audit,
          ),
        },
        {
          provide: RevokeTeamJobService,
          useValue: new RevokeTeamJobService(access, assignments, audit),
        },
        {
          provide: ListTeamJobAssignmentsService,
          useValue: new ListTeamJobAssignmentsService(access, teams, assignments),
        },
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
    app.useGlobalFilters(new ApiExceptionFilter());
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
  it('requires real project/job/staff assignments and unique active ownership, including concurrent requests', async () => {
    projectId = (
      await projects.create({
        organizationId,
        name: 'Workload fixture project',
        conversionType: ConversionType.COBOL_TO_JAVA,
        status: ProjectStatus.ACTIVE,
        createdBy: owner,
      })
    ).id;
    const created = await request('POST', '/teams', owner, {
      name: 'Conversion fixture',
      kind: TeamKind.CONVERSION,
      memberIds: [member, other],
      managerIds: [manager],
      projectAssignments: [{ projectId, memberIds: [member, other] }],
      expectedRevision: 0,
    });
    expect(created.status).toBe(201);
    conversionTeam = created.body as unknown as TeamRecord;
    // Persisted operational-state fixtures for aggregation only, not successful converter evidence.
    const statuses = [
      ConversionJobStatus.QUEUED,
      ConversionJobStatus.PROCESSING,
      ConversionJobStatus.COMPLETED,
      ConversionJobStatus.FAILED,
      ConversionJobStatus.COMPLETED,
      ConversionJobStatus.COMPLETED,
    ];
    for (let i = 0; i < statuses.length; i++) {
      const job = await connection.model<ConversionJob>(ConversionJob.name).create({
        organizationId,
        projectId,
        conversionType: ConversionType.COBOL_TO_JAVA,
        status: statuses[i],
        priority: 'NORMAL',
        createdBy: member,
        attemptCount: 3,
        maxAttempts: 3,
        createdAt: new Date(Date.now() - (i === 4 ? 10 : 1) * 86400000),
      });
      jobIds.push(String(job._id));
    }
    const endpoint = `/teams/${conversionTeam.id}/job-assignments`;
    expect(
      (await request('POST', endpoint, member, { jobId: jobIds[0], memberId: member })).status,
    ).toBe(403);
    expect(
      (await request('POST', endpoint, owner, { jobId: jobIds[0], memberId: foreign })).status,
    ).toBe(400);
    const race = await Promise.all([
      request('POST', endpoint, owner, { jobId: jobIds[0], memberId: member }),
      request('POST', endpoint, owner, { jobId: jobIds[0], memberId: member }),
    ]);
    expect(race.map((r) => r.status).sort()).toEqual([201, 409]);
    for (let i = 1; i < 5; i++)
      expect(
        (
          await request('POST', endpoint, owner, {
            jobId: jobIds[i],
            memberId: i < 2 ? member : other,
          })
        ).status,
      ).toBe(201);
    expect((await request('GET', endpoint)).status).toBe(200);
    expect((await request('GET', endpoint, member)).status).toBe(403);
    const foreignProject = await projects.create({
      organizationId: foreignOrganizationId,
      name: 'Foreign',
      conversionType: ConversionType.COBOL_TO_JAVA,
      status: ProjectStatus.ACTIVE,
      createdBy: foreign,
    });
    const foreignJob = await connection.model<ConversionJob>(ConversionJob.name).create({
      organizationId: foreignOrganizationId,
      projectId: foreignProject.id,
      conversionType: ConversionType.COBOL_TO_JAVA,
      status: ConversionJobStatus.QUEUED,
      priority: 'NORMAL',
      createdBy: foreign,
    });
    expect(
      (await request('POST', endpoint, owner, { jobId: String(foreignJob._id), memberId: member }))
        .status,
    ).toBe(400);
  });
  it('computes 7/30-day totals and member breakdowns from real assigned records without attempts, creators or generation duplication', async () => {
    const endpoint = `/teams/${conversionTeam.id}/workload`;
    const result = await request('GET', `${endpoint}?days=7`, manager);
    expect(result.status).toBe(200);
    expect(result.body.totals).toEqual({
      assignedJobs: 4,
      processingJobs: 1,
      completedJobs: 1,
      failedJobs: 1,
    });
    expect(result.body.members).toEqual([
      expect.objectContaining({
        userId: member,
        metrics: { assignedJobs: 2, processingJobs: 1, completedJobs: 0, failedJobs: 0 },
      }),
      expect.objectContaining({
        userId: other,
        metrics: { assignedJobs: 2, processingJobs: 0, completedJobs: 1, failedJobs: 1 },
      }),
    ]);
    expect(result.body.coverage).toBe('EXPLICIT_ASSIGNMENTS_ONLY');
    expect((await request('GET', `${endpoint}?days=30`, manager)).body.totals).toEqual({
      assignedJobs: 5,
      processingJobs: 1,
      completedJobs: 2,
      failedJobs: 1,
    });
    expect((await request('GET', `${endpoint}?days=7`, member)).status).toBe(404);
    expect((await request('GET', `${endpoint}?days=7`, other)).status).toBe(404);
    expect((await request('GET', `${endpoint}?days=7`, foreign)).status).toBe(403);
    expect((await request('GET', `${endpoint}?days=7&userId=${manager}`, member)).status).toBe(400);
    expect((await request('GET', `/teams/${team.id}/workload?days=7`, other)).status).toBe(404);
    await jobs.retry(jobIds[3], organizationId);
    expect((await request('GET', `${endpoint}?days=7`, manager)).body.totals).toEqual({
      assignedJobs: 4,
      processingJobs: 1,
      completedJobs: 1,
      failedJobs: 0,
    });
  });
  it('enforces half-open date boundaries and exact project/organization predicates in Mongo', async () => {
    const start = new Date('2026-10-01T00:00:00Z'),
      end = new Date('2026-10-08T00:00:00Z');
    const ids: string[] = [];
    for (const createdAt of [
      start,
      new Date(start.getTime() - 1),
      new Date(end.getTime() - 1),
      end,
    ]) {
      const job = await connection.model<ConversionJob>(ConversionJob.name).create({
        organizationId,
        projectId,
        conversionType: ConversionType.COBOL_TO_JAVA,
        status: ConversionJobStatus.QUEUED,
        priority: 'NORMAL',
        createdBy: member,
        createdAt,
      });
      ids.push(String(job._id));
    }
    expect(
      (await reader.listAssignedJobs({ organizationId, projectId, jobIds: ids, start, end }))
        .map((j) => j.id)
        .sort(),
    ).toEqual([ids[0], ids[2]].sort());
    expect(
      await reader.listAssignedJobs({
        organizationId: foreignOrganizationId,
        projectId,
        jobIds: ids,
        start,
        end,
      }),
    ).toEqual([]);
    expect(
      await reader.listAssignedJobs({
        organizationId,
        projectId: new Types.ObjectId().toHexString(),
        jobIds: ids,
        start,
        end,
      }),
    ).toEqual([]);
  });
  it('reconciles committed creation after audit failure without duplicate teams or overwriting later edits', async () => {
    const payload = { ...input(), creationId: new Types.ObjectId().toHexString() };
    const realAppend = audit.append.bind(audit);
    const failing = jest.spyOn(audit, 'append').mockImplementation(async (event) => {
      if (event.action === 'TEAM_SAVED') throw new Error('completion audit outage');
      return realAppend(event);
    });
    try {
      const response = await request('POST', '/teams', owner, payload);
      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({
        code: 'TEAM_MUTATION_COMMITTED_AUDIT_PENDING',
        details: [{ resourceId: payload.creationId, mutationCommitted: true, retrySafe: false }],
      });
      expect(
        (await request('GET', `/teams/${payload.creationId}/administration`)).body.revision,
      ).toBe(1);
    } finally {
      failing.mockRestore();
    }
    const concurrent = await Promise.all([
      request('POST', '/teams', owner, payload),
      request('POST', '/teams', owner, payload),
    ]);
    expect(concurrent.map((r) => r.body.id)).toEqual([payload.creationId, payload.creationId]);
    expect(
      await connection
        .collection('teams')
        .countDocuments({ _id: new Types.ObjectId(payload.creationId) }),
    ).toBe(1);
    expect(
      (await request('POST', '/teams', owner, { ...payload, name: 'Different intent' })).status,
    ).toBe(409);
    expect(
      (await request('POST', '/teams', owner, { ...payload, creationId: undefined })).status,
    ).toBe(400);
    const replacement = { ...payload, creationId: undefined };
    expect(
      (
        await request('PUT', `/teams/${payload.creationId}`, owner, {
          ...replacement,
          name: 'Edited later',
          expectedRevision: 1,
        })
      ).status,
    ).toBe(200);
    const replay = await request('POST', '/teams', owner, payload);
    expect(replay.body).toMatchObject({
      name: 'Edited later',
      revision: 2,
      replayedCreation: true,
    });
  });
  it('fences revoked assignment replays and delayed DELETE retries while retaining the original record', async () => {
    const endpoint = `/teams/${conversionTeam.id}/job-assignments`;
    const original = (await assignments.listActive(organizationId, conversionTeam.id)).find(
      (a) => a.jobId === jobIds[0],
    )!;
    const payload = {
      assignmentId: original.id,
      jobId: original.jobId,
      memberId: original.memberId,
    };
    const realAppend = audit.append.bind(audit);
    const failing = jest.spyOn(audit, 'append').mockImplementation(async (event) => {
      if (event.action === 'TEAM_JOB_REVOKED') throw new Error('completion audit outage');
      return realAppend(event);
    });
    try {
      expect(
        (await request('DELETE', `${endpoint}/${original.jobId}?assignmentId=${original.id}`)).body,
      ).toMatchObject({
        code: 'TEAM_MUTATION_COMMITTED_AUDIT_PENDING',
        details: [{ mutationCommitted: true, resourceId: original.id }],
      });
    } finally {
      failing.mockRestore();
    }
    const replacementInput = {
      ...payload,
      assignmentId: new Types.ObjectId().toHexString(),
    };
    const assignmentAuditFailure = jest.spyOn(audit, 'append').mockImplementation(async (event) => {
      if (event.action === 'TEAM_JOB_ASSIGNED') throw new Error('completion audit outage');
      return realAppend(event);
    });
    try {
      const uncertain = await request('POST', endpoint, owner, replacementInput);
      expect(uncertain.status).toBe(503);
      expect(uncertain.body).toMatchObject({
        code: 'TEAM_MUTATION_COMMITTED_AUDIT_PENDING',
        details: [
          { resourceId: replacementInput.assignmentId, mutationCommitted: true, retrySafe: false },
        ],
      });
      expect(
        (await request('GET', `${endpoint}/${replacementInput.assignmentId}`)).body.revokedAt,
      ).toBeNull();
    } finally {
      assignmentAuditFailure.mockRestore();
    }
    const replacement = await request('POST', endpoint, owner, replacementInput);
    expect(replacement.status).toBe(201);
    expect(replacement.body.replayed).toBe(true);
    const replay = await request('POST', endpoint, owner, payload);
    expect(replay.body).toMatchObject({ id: original.id, replayed: true });
    expect(replay.body.revokedAt).toBeTruthy();
    expect((await request('GET', `${endpoint}/${original.id}`)).body.revokedAt).toBeTruthy();
    expect((await request('GET', `${endpoint}/${original.id}`, member)).status).toBe(403);
    expect(
      (await request('DELETE', `${endpoint}/${original.jobId}?assignmentId=${original.id}`)).status,
    ).toBe(404);
    expect((await request('DELETE', `${endpoint}/${original.jobId}`)).status).toBe(400);
    expect((await request('POST', endpoint, owner, { ...payload, memberId: other })).status).toBe(
      409,
    );
    const active = (await assignments.listActive(organizationId, conversionTeam.id)).filter(
      (a) => a.jobId === original.jobId,
    );
    expect(active.map((a) => a.id)).toEqual([replacement.body.id]);
  });
  it('revokes assignments durably, prevents another team claiming an already assigned job, and excludes deleted projects', async () => {
    const second = await request('POST', '/teams', owner, {
      name: 'Other Conversion',
      kind: TeamKind.CONVERSION,
      memberIds: [member],
      managerIds: [other],
      projectAssignments: [{ projectId, memberIds: [member] }],
      expectedRevision: 0,
    });
    const secondId = String(second.body.id);
    expect(
      (
        await request('POST', `/teams/${secondId}/job-assignments`, owner, {
          jobId: jobIds[0],
          memberId: member,
        })
      ).status,
    ).toBe(409);
    expect((await request('GET', `/teams/${secondId}/workload?days=7`, other)).body.totals).toEqual(
      { assignedJobs: 0, processingJobs: 0, completedJobs: 0, failedJobs: 0 },
    );
    const active = (await assignments.listActive(organizationId, conversionTeam.id)).find(
      (a) => a.jobId === jobIds[1],
    )!;
    expect(
      (
        await request(
          'DELETE',
          `/teams/${conversionTeam.id}/job-assignments/${jobIds[1]}?assignmentId=${active.id}`,
          manager,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          'DELETE',
          `/teams/${conversionTeam.id}/job-assignments/${jobIds[1]}?assignmentId=${active.id}`,
        )
      ).status,
    ).toBe(200);
    expect(
      (await request('GET', `/teams/${conversionTeam.id}/workload?days=7`, manager)).body.totals,
    ).toEqual({ assignedJobs: 3, processingJobs: 0, completedJobs: 1, failedJobs: 0 });
    const retained = await connection
      .model<TeamJobAssignment>(TeamJobAssignment.name)
      .findOne({ jobId: new Types.ObjectId(jobIds[1]) })
      .lean();
    expect(retained?.revokedBy).toBe(owner);
    expect(retained?.revokedAt).toBeInstanceOf(Date);
    await projects.softDelete(projectId, organizationId);
    expect(
      (await request('GET', `/teams/${conversionTeam.id}/workload?days=7`, manager)).body.totals,
    ).toEqual({ assignedJobs: 0, processingJobs: 0, completedJobs: 0, failedJobs: 0 });
  });
  it('fails closed when the uniqueness index is missing, without admitting duplicate assignment records', async () => {
    verifyOwnedMongo();
    const model = connection.model<TeamJobAssignment>(TeamJobAssignment.name);
    await model.collection.dropIndex('one_active_team_job_assignment');
    try {
      await expect(
        assignments.assign({
          assignmentId: new Types.ObjectId().toHexString(),
          organizationId,
          teamId: conversionTeam.id,
          projectId,
          jobId: jobIds[5],
          memberId: member,
          assignedBy: owner,
        }),
      ).rejects.toThrow('The scoped active-assignment uniqueness index');
      expect(await model.countDocuments({ jobId: new Types.ObjectId(jobIds[5]) })).toBe(0);
    } finally {
      await model.createIndexes();
    }
  });
  it('does not authorize project assignments through the legacy project-name lookup fallback', async () => {
    const missingId = new Types.ObjectId().toHexString();
    await projects.create({
      organizationId,
      name: missingId,
      conversionType: ConversionType.COBOL_TO_JAVA,
      status: ProjectStatus.ACTIVE,
      createdBy: owner,
    });
    expect((await projects.findById(missingId, organizationId))?.id).not.toBe(missingId);
    const result = await request('POST', '/teams', owner, {
      name: 'Alias forbidden',
      kind: TeamKind.CONVERSION,
      memberIds: [member],
      managerIds: [manager],
      projectAssignments: [{ projectId: missingId, memberIds: [member] }],
      expectedRevision: 0,
    });
    expect(result.status).toBe(400);
    expect(await connection.collection('teams').countDocuments({ name: 'Alias forbidden' })).toBe(
      0,
    );
  });
});
