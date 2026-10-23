/**
 * Opt-in controller integration against owned emergency Docker services only.
 * Run: $env:ALSM_EMERGENCY_HTTP_TEST='owned-local-only';
 * npx ts-node test/emergency-conversion-http.integration-test.ts
 * Completed jobs below are explicitly seeded result fixtures, not converter evidence.
 */
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Queue } from 'bullmq';
import { Connection, createConnection, Model, Types } from 'mongoose';
import { AuditLog, AuditLogSchema } from '../src/modules/audit/infrastructure/audit-log.schema';
import { AUDIT_REPOSITORY } from '../src/modules/audit/domain/audit.repository';
import { MongoAuditRepository } from '../src/modules/audit/infrastructure/mongo-audit.repository';
import { ConversionJobService } from '../src/modules/conversions/application/conversion-job.service';
import { ConversionProjectAccessService } from '../src/modules/conversions/application/conversion-project-access.service';
import { RbacModule } from '../src/modules/rbac/rbac.module';
import { TEAM_REPOSITORY } from '../src/modules/teams/domain/team.types';
import { Team, TeamSchema } from '../src/modules/teams/infrastructure/team.schema';
import { MongoTeamRepository } from '../src/modules/teams/infrastructure/mongo-team.repository';
import { GetConversionQualityReviewService } from '../src/modules/conversions/application/get-conversion-quality-review.service';
import { GetConversionResultService } from '../src/modules/conversions/application/get-conversion-result.service';
import { SubmitConversionQualityReviewService } from '../src/modules/conversions/application/submit-conversion-quality-review.service';
import {
  CONVERSION_JOB_REPOSITORY,
  CONVERSION_QUEUE,
  ConversionJobRepository,
  ConversionJobStatus,
  ConversionPriority,
} from '../src/modules/conversions/domain/conversion-job.types';
import { CONVERSION_QUALITY_REVIEW_REPOSITORY } from '../src/modules/conversions/domain/conversion-quality-review.types';
import {
  BullMqConversionQueue,
  CONVERSION_QUEUE_NAME,
} from '../src/modules/conversions/infrastructure/bullmq-conversion.queue';
import {
  ConversionJob,
  ConversionJobSchema,
} from '../src/modules/conversions/infrastructure/conversion-job.schema';
import {
  ConversionQualityReview,
  ConversionQualityReviewSchema,
} from '../src/modules/conversions/infrastructure/conversion-quality-review.schema';
import { MongoConversionJobRepository } from '../src/modules/conversions/infrastructure/mongo-conversion-job.repository';
import { MongoConversionQualityReviewRepository } from '../src/modules/conversions/infrastructure/mongo-conversion-quality-review.repository';
import { ConversionsController } from '../src/modules/conversions/presentation/conversions.controller';
import { QualityReviewController } from '../src/modules/conversions/presentation/quality-review.controller';
import { OrganizationAuthorizationService } from '../src/modules/organizations/application/organization-authorization.service';
import { OrganizationContextService } from '../src/modules/organizations/application/organization-context.service';
import {
  ORGANIZATION_REPOSITORY,
  OrganizationRepository,
} from '../src/modules/organizations/domain/organization.repository';
import {
  OrganizationRole,
  OrganizationType,
} from '../src/modules/organizations/domain/organization.types';
import { MongoOrganizationRepository } from '../src/modules/organizations/infrastructure/mongo-organization.repository';
import {
  Organization,
  OrganizationSchema,
} from '../src/modules/organizations/infrastructure/organization.schema';
import { ProjectService } from '../src/modules/projects/application/project.service';
import { ConversionType, PROJECT_REPOSITORY } from '../src/modules/projects/domain/project.types';
import { MongoProjectRepository } from '../src/modules/projects/infrastructure/mongo-project.repository';
import { Project, ProjectSchema } from '../src/modules/projects/infrastructure/project.schema';
import { ProjectsController } from '../src/modules/projects/presentation/projects.controller';
import {
  SCREEN_REPOSITORY,
  ScreenRepository,
  ScreenSourceType,
  ScreenStatus,
} from '../src/modules/screens/domain/screen.types';
import { MongoScreenRepository } from '../src/modules/screens/infrastructure/mongo-screen.repository';
import { Screen, ScreenSchema } from '../src/modules/screens/infrastructure/screen.schema';
import { USER_REPOSITORY, UserRepository } from '../src/modules/users/domain/user.repository';
import { MongoUserRepository } from '../src/modules/users/infrastructure/mongo-user.repository';
import { User, UserSchema } from '../src/modules/users/infrastructure/user.schema';
import { JwtAuthGuard } from '../src/shared/security/jwt-auth.guard';
import { RequireCurrentSessionService } from '../src/modules/auth/application/require-current-session.service';
import {
  SESSION_REPOSITORY,
  SessionRepository,
} from '../src/modules/auth/domain/session.repository';
import { MongoSessionRepository } from '../src/modules/auth/infrastructure/mongo-session.repository';
import {
  UserSession,
  UserSessionSchema,
} from '../src/modules/auth/infrastructure/user-session.schema';
import { LocalDiskStorageAdapter } from '../src/shared/storage/local-disk-storage.adapter';
import { STORAGE_PORT, StoragePort } from '../src/shared/storage/storage.port';

const OWNER = 'emergency-20261017';
const MONGO_URI = 'mongodb://127.0.0.1:27117';
const REDIS_CONNECTION = { host: '127.0.0.1', port: 6397 };
const DB_PREFIX = 'alsm_emergency_http_';
const MARKER = '_emergency_http_ownership';

interface InspectedContainer {
  Config: { Labels?: Record<string, string> };
  State: { Running: boolean };
  NetworkSettings: { Ports: Record<string, { HostIp: string; HostPort: string }[] | null> };
}

function verifyOwnedContainers(): void {
  for (const [name, port, hostPort] of [
    [`alsm-${OWNER}-mongo`, '27017/tcp', '27117'],
    [`alsm-${OWNER}-redis`, '6379/tcp', '6397'],
  ]) {
    const inspected = JSON.parse(
      execFileSync('docker', ['inspect', name], {
        encoding: 'utf8',
        windowsHide: true,
      }),
    ) as InspectedContainer[];
    assert.equal(inspected.length, 1, 'Exact owned container required');
    assert.equal(inspected[0].Config.Labels?.['alsm.owner'], OWNER, 'Wrong container owner');
    assert.equal(inspected[0].State.Running, true, 'Owned service must be running');
    const bindings = inspected[0].NetworkSettings.Ports[port];
    assert.ok(bindings && bindings.length === 1, 'Exact service port binding required');
    assert.equal(bindings[0].HostIp, '127.0.0.1', 'Only loopback binding is allowed');
    assert.equal(bindings[0].HostPort, hostPort, 'Unexpected owned service port');
  }
}

interface ApiJob {
  id: string;
  status: string;
  projectId: string;
  organizationId: string;
  executionGeneration?: number;
}
interface ApiProject {
  id: string;
  name: string;
  organizationId: string;
}
interface ApiReview {
  id: string;
  status: string;
  reviewedBy?: string;
  reviewNote?: string;
  qualityScore?: number;
}
interface ReviewResponse {
  review: ApiReview;
  fileSummary: { fileCount: number; totalLines: number };
}

async function main(): Promise<void> {
  if (process.env.ALSM_EMERGENCY_HTTP_TEST !== 'owned-local-only') {
    console.log(
      'SKIPPED: set ALSM_EMERGENCY_HTTP_TEST=owned-local-only to run owned local HTTP integration.',
    );
    return;
  }
  verifyOwnedContainers(); // Before opening any database/queue connection.
  const runId = randomUUID();
  const database = `${DB_PREFIX}${runId.replace(/-/g, '')}`;
  assert.match(database, /^alsm_emergency_http_[a-f0-9]{32}$/);
  const uri = `${MONGO_URI}/${database}`;
  const ownership = await createConnection(uri, { serverSelectionTimeoutMS: 5000 }).asPromise();
  const db = ownership.db;
  assert.ok(db);
  let ownsDatabase = false;
  let app: INestApplication | undefined;
  let queue: Queue | undefined;
  let storageRoot: string | undefined;
  let passed = 0;
  try {
    assert.equal((await db.listCollections().toArray()).length, 0, 'Refusing nonempty database');
    await db.collection(MARKER).insertOne({ owner: OWNER, runId, database });
    ownsDatabase = true;
    storageRoot = await mkdtemp(path.join(os.tmpdir(), 'alsm-emergency-http-'));
    const secret = randomUUID() + randomUUID();
    const moduleRef = await Test.createTestingModule({
      imports: [
        RbacModule,
        JwtModule.register({ secret }),
        MongooseModule.forRoot(uri, { serverSelectionTimeoutMS: 5000 }),
        MongooseModule.forFeature([
          { name: Team.name, schema: TeamSchema },
          { name: Organization.name, schema: OrganizationSchema },
          { name: Project.name, schema: ProjectSchema },
          { name: User.name, schema: UserSchema },
          { name: UserSession.name, schema: UserSessionSchema },
          { name: Screen.name, schema: ScreenSchema },
          { name: AuditLog.name, schema: AuditLogSchema },
          { name: ConversionJob.name, schema: ConversionJobSchema },
          { name: ConversionQualityReview.name, schema: ConversionQualityReviewSchema },
        ]),
      ],
      controllers: [ProjectsController, ConversionsController, QualityReviewController],
      providers: [
        ConversionProjectAccessService,
        { provide: TEAM_REPOSITORY, useClass: MongoTeamRepository },
        {
          provide: ConfigService,
          useValue: new ConfigService({
            JWT_ACCESS_SECRET: secret,
            STORAGE_ROOT: storageRoot,
            REDIS_HOST: REDIS_CONNECTION.host,
            REDIS_PORT: REDIS_CONNECTION.port,
            REDIS_PASSWORD: '',
            CONVERSION_WORKER_ENABLED: true,
          }),
        },
        { provide: USER_REPOSITORY, useClass: MongoUserRepository },
        { provide: SESSION_REPOSITORY, useClass: MongoSessionRepository },
        RequireCurrentSessionService,
        { provide: ORGANIZATION_REPOSITORY, useClass: MongoOrganizationRepository },
        { provide: PROJECT_REPOSITORY, useClass: MongoProjectRepository },
        { provide: SCREEN_REPOSITORY, useClass: MongoScreenRepository },
        { provide: AUDIT_REPOSITORY, useClass: MongoAuditRepository },
        { provide: CONVERSION_JOB_REPOSITORY, useClass: MongoConversionJobRepository },
        {
          provide: CONVERSION_QUALITY_REVIEW_REPOSITORY,
          useClass: MongoConversionQualityReviewRepository,
        },
        { provide: CONVERSION_QUEUE, useClass: BullMqConversionQueue },
        { provide: STORAGE_PORT, useClass: LocalDiskStorageAdapter },
        JwtAuthGuard,
        OrganizationContextService,
        OrganizationAuthorizationService,
        ProjectService,
        ConversionJobService,
        GetConversionResultService,
        GetConversionQualityReviewService,
        SubmitConversionQualityReviewService,
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const connection = moduleRef.get<Connection>(getConnectionToken());
    assert.equal(connection.name, database);
    await moduleRef
      .get<Model<ConversionQualityReview>>(getModelToken(ConversionQualityReview.name))
      .init();
    queue = new Queue(CONVERSION_QUEUE_NAME, { connection: REDIS_CONNECTION });
    await queue.waitUntilReady();
    const users = moduleRef.get<UserRepository>(USER_REPOSITORY);
    const organizations = moduleRef.get<OrganizationRepository>(ORGANIZATION_REPOSITORY);
    const jobs = moduleRef.get<ConversionJobRepository>(CONVERSION_JOB_REPOSITORY);
    const screens = moduleRef.get<ScreenRepository>(SCREEN_REPOSITORY);
    const storage = moduleRef.get<StoragePort>(STORAGE_PORT);
    const jwt = moduleRef.get(JwtService);
    const owner = await users.create({
      email: `${runId}-owner@example.invalid`,
      fullName: 'HTTP Test Owner',
    });
    const viewer = await users.create({
      email: `${runId}-viewer@example.invalid`,
      fullName: 'HTTP Test Viewer',
    });
    const outsider = await users.create({
      email: `${runId}-outsider@example.invalid`,
      fullName: 'HTTP Other Owner',
    });
    const orgA = await organizations.create({
      name: 'HTTP fixture A',
      type: OrganizationType.INTERNAL,
      members: [
        { userId: owner.id, role: OrganizationRole.OWNER },
        { userId: viewer.id, role: OrganizationRole.VIEWER },
      ],
    });
    const orgB = await organizations.create({
      name: 'HTTP fixture B',
      type: OrganizationType.INTERNAL,
      members: [{ userId: outsider.id, role: OrganizationRole.OWNER }],
    });
    const sessions = moduleRef.get<SessionRepository>(SESSION_REPOSITORY);
    const token = async (user: { id: string; email: string }) => {
      const session = await sessions.create({
        userId: user.id,
        tokenId: randomUUID(),
        refreshTokenHash: 'fixture-not-a-refresh-credential',
        expiresAt: new Date(Date.now() + 60000),
      });
      return jwt.sign({ sub: user.id, sid: session.id, email: user.email, isPlatformAdmin: false });
    };
    const ownerToken = await token(owner);
    const viewerToken = await token(viewer);
    const otherToken = await token(outsider);
    async function request<T>(
      method: string,
      route: string,
      expected: number,
      accessToken?: string,
      organizationId?: string,
      body?: object,
    ): Promise<T> {
      const response = await fetch(`${origin}/api/v1${route}`, {
        method,
        headers: {
          ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
          ...(organizationId ? { 'x-organization-id': organizationId } : {}),
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const raw = await response.text();
      assert.equal(
        response.status,
        expected,
        `${method} ${route}: expected ${expected}, got ${response.status}; ${raw}`,
      );
      return (raw ? JSON.parse(raw) : undefined) as T;
    }
    async function check(name: string, run: () => Promise<void>): Promise<void> {
      await run();
      passed += 1;
      console.log(`PASS ${passed}: ${name}`);
    }
    await check(
      'real JWT rejects missing, malformed and invalidly signed access tokens',
      async () => {
        await request('GET', '/projects', 401);
        await request('GET', '/projects', 401, 'invalid.jwt');
        await request(
          'GET',
          '/projects',
          401,
          jwt.sign({ sub: owner.id }, { secret: 'deliberately-wrong-test-secret' }),
        );
      },
    );
    let projectA!: ApiProject;
    let projectB!: ApiProject;
    await check(
      'real membership resolves empty list then HTTP project creation is tenant scoped',
      async () => {
        assert.deepEqual(await request('GET', '/projects', 200, ownerToken, orgA.id), []);
        projectA = await request<ApiProject>('POST', '/projects', 201, ownerToken, orgA.id, {
          name: 'HTTP A source',
          conversionType: ConversionType.COBOL_TO_JAVA,
        });
        projectB = await request<ApiProject>('POST', '/projects', 201, otherToken, orgB.id, {
          name: 'HTTP B source',
          conversionType: ConversionType.COBOL_TO_JAVA,
        });
        assert.equal(projectA.organizationId, orgA.id);
        assert.deepEqual(
          (await request<ApiProject[]>('GET', '/projects', 200, ownerToken, orgA.id)).map(
            (p) => p.id,
          ),
          [projectA.id],
        );
        await request('GET', '/projects', 403, ownerToken, orgB.id);
        await request('GET', `/projects/${projectB.id}`, 404, ownerToken, orgA.id);
      },
    );
    // Uploaded source fixture for the HTTP enqueue test; no converter is invoked.
    const sourceReference = await storage.writeFiles(`http-fixtures/${runId}/source`, [
      {
        relativePath: 'fixture.cbl',
        content: Buffer.from('       IDENTIFICATION DIVISION.\n       PROGRAM-ID. FIXTURE.'),
      },
    ]);
    const screen = await screens.create({
      organizationId: orgA.id,
      projectId: projectA.id,
      createdBy: owner.id,
      name: 'HTTP fixture.cbl',
      sourceType: ScreenSourceType.COBOL,
      status: ScreenStatus.READY,
      inputReference: sourceReference,
    });
    let queuedJob!: ApiJob;
    await check(
      'HTTP create persists QUEUED and enqueues exact job generation in actual Redis',
      async () => {
        queuedJob = await request<ApiJob>(
          'POST',
          `/projects/${projectA.id}/conversions`,
          201,
          ownerToken,
          orgA.id,
          { screenId: screen.id, priority: ConversionPriority.NORMAL },
        );
        assert.equal(queuedJob.status, ConversionJobStatus.QUEUED);
        assert.equal(
          (await jobs.findById(queuedJob.id, orgA.id))?.status,
          ConversionJobStatus.QUEUED,
        );
        const redisJob = await queue!.getJob(`${queuedJob.id}-0`);
        assert.ok(redisJob, 'Persistent job must have a real Redis entry');
        assert.deepEqual(redisJob.data, { conversionJobId: queuedJob.id, executionGeneration: 0 });
        assert.ok(['waiting', 'prioritized'].includes(await redisJob.getState()));
        const history = await request<ApiJob[]>(
          'GET',
          `/projects/${projectA.id}/conversions`,
          200,
          ownerToken,
          orgA.id,
        );
        assert.ok(
          history.some(
            (job) => job.id === queuedJob.id && job.status === ConversionJobStatus.QUEUED,
          ),
        );
        const retrieved = await request<ApiJob>(
          'GET',
          `/conversions/${queuedJob.id}`,
          200,
          ownerToken,
          orgA.id,
        );
        assert.equal(retrieved.organizationId, orgA.id);
        await request('GET', `/projects/${projectA.id}/conversions`, 403, otherToken, orgA.id);
        await request('GET', `/conversions/${queuedJob.id}`, 404, otherToken, orgB.id);
        await request('GET', `/projects/${projectA.id}/conversions`, 404, otherToken, orgB.id);
        await request('POST', `/conversions/${queuedJob.id}/retry`, 403, ownerToken, orgB.id);
      },
    );
    console.log(
      'FIXTURE: completed review jobs below are seeded persisted result fixtures; no conversion success is claimed.',
    );
    const resultReference = await storage.writeFiles(`http-fixtures/${runId}/completed-results`, [
      {
        relativePath: 'Fixture.java',
        content: Buffer.from('class Fixture {\n  int value = 1;\n}'),
      },
    ]);
    const completed = await jobs.create({
      organizationId: orgA.id,
      projectId: projectA.id,
      createdBy: owner.id,
      conversionType: ConversionType.COBOL_TO_JAVA,
      status: ConversionJobStatus.COMPLETED,
      priority: ConversionPriority.NORMAL,
      attemptCount: 1,
      maxAttempts: 3,
      resultReference,
      toolVersion: 'explicit-http-result-fixture',
      completedAt: new Date(),
    });
    const reviewRoute = `/projects/${projectA.id}/conversions/${completed.id}/quality-review`;
    const failed = await jobs.create({
      organizationId: orgA.id,
      projectId: projectA.id,
      createdBy: owner.id,
      conversionType: ConversionType.COBOL_TO_JAVA,
      status: ConversionJobStatus.FAILED,
      priority: ConversionPriority.NORMAL,
      attemptCount: 3,
      maxAttempts: 3,
      errorCode: 'HTTP_SEEDED_FAILURE_FIXTURE',
    });
    await check(
      'VIEWER cannot retry, create jobs or submit quality decisions; no persistence mutation',
      async () => {
        await request('POST', `/conversions/${failed.id}/retry`, 403, viewerToken, orgA.id);
        assert.equal((await jobs.findById(failed.id, orgA.id))?.status, ConversionJobStatus.FAILED);
        await request('POST', `/projects/${projectA.id}/conversions`, 403, viewerToken, orgA.id, {
          screenId: screen.id,
        });
        await request('PATCH', reviewRoute, 403, viewerToken, orgA.id, { status: 'ACCEPTED' });
        assert.equal(await db.collection('conversion_quality_reviews').countDocuments(), 0);
      },
    );
    await check(
      'review HTTP GET/PATCH persists real decision, audit and reload with result fixture',
      async () => {
        const pending = await request<ReviewResponse>('GET', reviewRoute, 200, ownerToken, orgA.id);
        assert.equal(pending.review.status, 'PENDING');
        assert.equal(pending.fileSummary.fileCount, 1);
        assert.equal(pending.fileSummary.totalLines, 3);
        const accepted = await request<ApiReview>('PATCH', reviewRoute, 200, ownerToken, orgA.id, {
          status: 'ACCEPTED',
          reviewNote: 'Explicit persisted result fixture reviewed over HTTP',
          qualityScore: 4,
        });
        assert.equal(accepted.status, 'ACCEPTED');
        assert.equal(accepted.reviewedBy, owner.id);
        const reloaded = await request<ReviewResponse>(
          'GET',
          reviewRoute,
          200,
          ownerToken,
          orgA.id,
        );
        assert.equal(reloaded.review.id, accepted.id);
        assert.equal(reloaded.review.status, 'ACCEPTED');
        assert.equal(reloaded.review.qualityScore, 4);
        const persisted = await db.collection('conversion_quality_reviews').findOne({
          _id: new Types.ObjectId(accepted.id),
          conversionJobId: new Types.ObjectId(completed.id),
          projectId: new Types.ObjectId(projectA.id),
          organizationId: new Types.ObjectId(orgA.id),
        });
        assert.equal(persisted?.status, 'ACCEPTED');
        assert.equal(persisted?.qualityScore, 4);
        assert.equal(
          await db.collection('audit_logs').countDocuments({
            action: 'CONVERSION_QUALITY_REVIEW_SUBMITTED',
            resourceId: accepted.id,
          }),
          1,
        );
        await request('GET', reviewRoute, 403, otherToken, orgA.id);
        await request('PATCH', reviewRoute, 404, otherToken, orgB.id, {
          status: 'NEEDS_REWORK',
          reviewNote: 'Denied',
        });
      },
    );
    await check(
      'HTTP validation rejects invalid decision/score and missing rework note',
      async () => {
        await request('PATCH', reviewRoute, 400, ownerToken, orgA.id, { status: 'APPROVED' });
        await request('PATCH', reviewRoute, 400, ownerToken, orgA.id, { status: 'NEEDS_REWORK' });
        await request('PATCH', reviewRoute, 400, ownerToken, orgA.id, {
          status: 'NEEDS_REWORK',
          reviewNote: 'Fix',
          qualityScore: 6,
        });
      },
    );
    await check(
      'missing output is unavailable, never a fabricated zero-file summary or accepted review',
      async () => {
        const missing = await jobs.create({
          organizationId: orgA.id,
          projectId: projectA.id,
          createdBy: owner.id,
          conversionType: ConversionType.COBOL_TO_JAVA,
          status: ConversionJobStatus.COMPLETED,
          priority: ConversionPriority.NORMAL,
          attemptCount: 1,
          maxAttempts: 3,
          resultReference: `missing-http-fixture/${runId}`,
          toolVersion: 'explicit-missing-result-fixture',
        });
        const route = `/projects/${projectA.id}/conversions/${missing.id}/quality-review`;
        const error = await request<{ code: string }>('GET', route, 503, ownerToken, orgA.id);
        assert.equal(error.code, 'CONVERSION_RESULT_UNAVAILABLE');
        await request('PATCH', route, 503, ownerToken, orgA.id, { status: 'ACCEPTED' });
        assert.equal(await db.collection('conversion_quality_reviews').countDocuments(), 1);
      },
    );
    await check(
      'soft-deleted project denies conversion history, job detail, review read/write and retry',
      async () => {
        await request('DELETE', `/projects/${projectA.id}`, 204, ownerToken, orgA.id);
        assert.deepEqual(await request('GET', '/projects', 200, ownerToken, orgA.id), []);
        await request('GET', `/projects/${projectA.id}/conversions`, 404, ownerToken, orgA.id);
        await request('GET', `/conversions/${completed.id}`, 404, ownerToken, orgA.id);
        await request('GET', reviewRoute, 404, ownerToken, orgA.id);
        await request('PATCH', reviewRoute, 404, ownerToken, orgA.id, {
          status: 'NEEDS_REWORK',
          reviewNote: 'Denied',
        });
        await request('POST', `/conversions/${failed.id}/retry`, 404, ownerToken, orgA.id);
      },
    );
    console.log(
      `HTTP INTEGRATION PASS: ${passed} checks; real Nest/JWT/Mongo/Redis/storage; completed results explicitly seeded fixtures.`,
    );
  } finally {
    await app?.close();
    verifyOwnedContainers();
    if (ownsDatabase) {
      assert.equal(
        (await db.collection(MARKER).findOne({ owner: OWNER, runId, database }))?.runId,
        runId,
        'Ownership marker required for cleanup',
      );
      // Remove only queue entries for IDs in this test's owned database. Never drain shared Redis.
      if (queue) {
        const ownedJobs = await db
          .collection('conversion_jobs')
          .find({}, { projection: { _id: 1, executionGeneration: 1 } })
          .toArray();
        for (const job of ownedJobs) {
          for (
            let generation = 0;
            generation <= Number(job.executionGeneration ?? 0);
            generation += 1
          ) {
            const queued = await queue.getJob(`${String(job._id)}-${generation}`);
            if (queued) await queued.remove();
          }
        }
      }
      assert.ok(database.startsWith(DB_PREFIX));
      await db.dropDatabase();
      console.log(`CLEANUP: dropped owned database ${database}; removed only its Redis jobs.`);
    }
    await queue?.close();
    await ownership.close();
    if (storageRoot) {
      const resolved = path.resolve(storageRoot);
      assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
      assert.ok(path.basename(resolved).startsWith('alsm-emergency-http-'));
      await rm(resolved, { recursive: true, force: true });
    }
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
