import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Connection, createConnection, Model, Types } from 'mongoose';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest');
import { RbacSeedService } from '../src/modules/rbac/application/rbac-seed.service';
import { CONVERSION_QUEUE } from '../src/modules/conversions/domain/conversion-job.types';
import { VALIDATION_QUEUE } from '../src/modules/validation/domain/validation-queue.port';
import { MongoAuditRepository } from '../src/modules/audit/infrastructure/mongo-audit.repository';
import { SupportTicket } from '../src/modules/support/infrastructure/support-ticket.schema';
import {
  SUPPORT_TICKET_ACCESS,
  SupportTicketAccessPort,
} from '../src/modules/support/application/support-ticket-access.port';
import { ApiExceptionFilter } from '../src/shared/errors/api-exception.filter';

// Exactly the accepted C opt-in/topology. No arbitrary URI, env-file credentials,
// service startup, application database or external engines/queues are used.
const owned =
  process.env.ALSM_SUPPORT_TICKET_TEST === 'owned-local-only' ? describe : describe.skip;
owned('Owner Ticket API with production AppModule and owned MongoDB', () => {
  const runId = randomUUID().replaceAll('-', '');
  const database = `alsm_support_ticket_api_${runId}`;
  const uri = `mongodb://127.0.0.1:27127/${database}?replicaSet=alsmPriorities&directConnection=true`;
  const secret = 'owned-support-ticket-api-test-secret-32-characters';
  const ids = {
    owner: '111111111111111111111111',
    member: '222222222222222222222222',
    staff: '333333333333333333333333',
    admin: '444444444444444444444444',
    org: '555555555555555555555555',
    foreign: '666666666666666666666666',
  };
  const base = `/api/v1/organizations/${ids.org}/support-tickets`;
  const originalEnvironment = { ...process.env };
  let app: INestApplication | undefined;
  let connection: Connection;
  let ownership: Connection | undefined;
  let marked = false;
  let jwt: JwtService;
  let tickets: Model<SupportTicket>;

  function verifyContainer() {
    const [info] = JSON.parse(
      execFileSync('docker', ['inspect', 'alsm-priorities-20261017-mongo-rs'], {
        encoding: 'utf8',
        windowsHide: true,
      }),
    );
    expect(info.State.Running).toBe(true);
    expect(info.Config.Labels['alsm.owner']).toBe('priorities-20261017');
    expect(info.NetworkSettings.Ports['27017/tcp']).toEqual([
      { HostIp: '127.0.0.1', HostPort: '27127' },
    ]);
  }
  const sessionId = (actor: string) => actor.slice(0, -1) + 'a';
  const token = (actor = ids.owner, extra = {}) =>
    jwt.sign(
      {
        sub: actor,
        sid: sessionId(actor),
        sv: 'fixture-v1',
        email: `${actor}@example.invalid`,
        isPlatformAdmin: actor === ids.admin,
        ...extra,
      },
      { secret },
    );
  const call = (method: 'post' | 'get', path: string, body?: object, actor = ids.owner) => {
    const operation = request(app!.getHttpServer())
      [method](path)
      .set('Authorization', `Bearer ${token(actor)}`);
    return body ? operation.send(body) : operation;
  };
  async function create() {
    const response = await call('post', base, { purposeId: 'owned-api-fixture' });
    expect(response.status).toBe(201);
    return response.body as { ticketId: string; episodeId: string; revision: number };
  }

  beforeAll(async () => {
    verifyContainer();
    ownership = await createConnection(uri, {
      autoCreate: false,
      autoIndex: false,
      serverSelectionTimeoutMS: 5000,
      timeoutMS: 10000,
    }).asPromise();
    expect((await ownership.db!.admin().command({ hello: 1 })).setName).toBe('alsmPriorities');
    expect(await ownership.db!.listCollections().toArray()).toHaveLength(0);
    await ownership.collection('_support_ticket_api_owner').insertOne({ runId, database });
    marked = true;
    Object.assign(process.env, {
      NODE_ENV: 'test',
      MONGODB_URI: uri,
      REDIS_HOST: '127.0.0.1',
      JWT_ACCESS_SECRET: secret,
      JWT_REFRESH_SECRET: secret,
      MFA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
      CORS_ORIGINS: 'http://localhost',
      AI_VALIDATION_ENABLED: 'false',
      AI_PROVIDER: 'fake',
      CONVERSION_WORKER_ENABLED: 'false',
      VALIDATION_WORKER_ENABLED: 'false',
    });
    const { AppModule } = await import('../src/app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RbacSeedService)
      .useValue({ onApplicationBootstrap: async () => undefined })
      .overrideProvider(CONVERSION_QUEUE)
      .useValue({ enqueue: jest.fn() })
      .overrideProvider(VALIDATION_QUEUE)
      .useValue({ enqueue: jest.fn() })
      .compile();
    app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
    connection = app.get(getConnectionToken());
    jwt = app.get(JwtService);
    tickets = app.get(getModelToken(SupportTicket.name));
    expect(connection.name).toBe(database);
    await tickets.init();
  }, 30000);
  afterAll(async () => {
    try {
      if (ownership && marked) {
        verifyContainer();
        expect(ownership.name).toBe(database);
        expect(
          await ownership.collection('_support_ticket_api_owner').findOne({ runId, database }),
        ).toBeTruthy();
        await ownership.dropDatabase();
      }
    } finally {
      if (app) await app.close();
      if (ownership) await ownership.close();
      process.env = originalEnvironment;
    }
  });
  beforeEach(async () => {
    jest.restoreAllMocks();
    for (const name of [
      'users',
      'user_sessions',
      'organizations',
      'user_roles',
      'temporary_roles',
      'support_tickets',
      'audit_logs',
    ])
      await connection.collection(name).deleteMany({});
    const actors = [ids.owner, ids.member, ids.staff, ids.admin];
    await connection
      .collection('users')
      .insertMany(
        actors.map((actor) => ({
          _id: new Types.ObjectId(actor),
          email: `${actor}@example.invalid`,
          fullName: 'Owned Fixture',
          isActive: true,
          isLocked: false,
          isEmailVerified: true,
          mustChangePassword: false,
          isPlatformAdmin: actor === ids.admin,
        })),
      );
    await connection
      .collection('user_sessions')
      .insertMany(
        actors.map((actor) => ({
          _id: new Types.ObjectId(sessionId(actor)),
          userId: new Types.ObjectId(actor),
          tokenId: randomUUID(),
          refreshTokenHash: 'fixture-not-a-credential',
          accessVersion: 'fixture-v1',
          expiresAt: new Date(Date.now() + 600000),
        })),
      );
    await connection.collection('organizations').insertMany([
      {
        _id: new Types.ObjectId(ids.org),
        name: 'Owned API fixture',
        type: 'ENTERPRISE',
        status: 'ACTIVE',
        members: [
          { userId: new Types.ObjectId(ids.owner), role: 'OWNER' },
          { userId: new Types.ObjectId(ids.member), role: 'MEMBER' },
          { userId: new Types.ObjectId(ids.staff), role: 'OWNER' },
        ],
      },
      {
        _id: new Types.ObjectId(ids.foreign),
        name: 'Foreign API fixture',
        type: 'ENTERPRISE',
        status: 'ACTIVE',
        members: [{ userId: new Types.ObjectId(ids.admin), role: 'OWNER' }],
      },
    ]);
    await connection
      .collection('user_roles')
      .insertOne({ userId: ids.staff, roleId: 'INTERNAL_SUPPORT' });
  });

  it('creates through production DI with one atomic audit and safe response fields', async () => {
    const created = await create();
    const stored = await connection
      .collection<SupportTicket>('support_tickets')
      .findOne({ _id: created.ticketId });
    expect(stored).toMatchObject({
      requesterUserId: new Types.ObjectId(ids.owner),
      organizationId: new Types.ObjectId(ids.org),
      decisionReferences: null,
    });
    const entries = await connection
      .collection('audit_logs')
      .find({ resourceId: created.ticketId })
      .toArray();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actorUserId: new Types.ObjectId(ids.owner),
      organizationId: new Types.ObjectId(ids.org),
      action: 'SUPPORT_TICKET_CREATED',
      metadata: { episodeId: created.episodeId, revision: '0', status: 'OPEN' },
    });
    const read = await call('get', `${base}/${created.ticketId}`);
    expect(read.status).toBe(200);
    expect(read.body).not.toHaveProperty('requesterUserId');
    expect(read.body).not.toHaveProperty('episodes');
    expect(read.body).not.toHaveProperty('decisionReferences');
  });
  it('closes, reopens, cancels and reopens retaining history and exact audit attribution', async () => {
    const created = await create();
    const episodes = new Set([created.episodeId]);
    for (const [index, action] of ['close', 'reopen', 'cancel', 'reopen'].entries()) {
      const response = await call('post', `${base}/${created.ticketId}/${action}`, {
        expectedRevision: index,
      });
      expect(response.status).toBe(200);
      expect(response.body.revision).toBe(index + 1);
      if (action === 'reopen') {
        expect(episodes.has(response.body.episodeId)).toBe(false);
        episodes.add(response.body.episodeId);
      }
    }
    const stored = await connection
      .collection<SupportTicket>('support_tickets')
      .findOne({ _id: created.ticketId });
    expect(stored?.episodes).toHaveLength(3);
    expect(stored?.decisionReferences).toBeNull();
    const audits = await connection
      .collection('audit_logs')
      .find({ resourceId: created.ticketId })
      .sort({ 'metadata.revision': 1 })
      .toArray();
    expect(audits).toHaveLength(5);
    for (const [index, entry] of audits.entries()) {
      expect(String(entry.actorUserId)).toBe(ids.owner);
      expect(String(entry.organizationId)).toBe(ids.org);
      expect(entry.metadata.revision).toBe(String(index));
      if (index > 0) expect(entry.metadata.expectedRevision).toBe(String(index - 1));
    }
  });
  it.each(['member', 'staff', 'admin'] as const)(
    'denies %s on every route without Ticket/audit effects',
    async (kind) => {
      const created = await create();
      const actor = ids[kind];
      for (const suffix of ['close', 'cancel', 'reopen'])
        expect(
          (
            await call(
              'post',
              `${base}/${created.ticketId}/${suffix}`,
              { expectedRevision: 0 },
              actor,
            )
          ).status,
        ).toBe(403);
      expect((await call('post', base, { purposeId: 'denied' }, actor)).status).toBe(403);
      expect((await call('get', base, undefined, actor)).status).toBe(403);
      expect((await call('get', `${base}/${created.ticketId}`, undefined, actor)).status).toBe(403);
      expect(await tickets.countDocuments()).toBe(1);
      expect(await connection.collection('audit_logs').countDocuments()).toBe(1);
    },
  );
  it('hides foreign Ticket existence for reads and lifecycle actions', async () => {
    const foreignPath = base.replace(ids.org, ids.foreign);
    const foreignTicket = await call('post', foreignPath, { purposeId: 'foreign' }, ids.admin);
    expect(foreignTicket.status).toBe(201);
    expect((await call('get', foreignPath)).status).toBe(403);
    const missing = randomUUID();
    for (const id of [foreignTicket.body.ticketId, missing]) {
      expect((await call('get', `${base}/${id}`)).body.code).toBe('SUPPORT_TICKET_NOT_FOUND');
      expect((await call('post', `${base}/${id}/close`, { expectedRevision: 0 })).body.code).toBe(
        'SUPPORT_TICKET_NOT_FOUND',
      );
    }
    expect(await connection.collection('audit_logs').countDocuments()).toBe(1);
  });
  it('also denies a current temporary Support assignment on an otherwise valid Owner', async () => {
    await connection
      .collection('temporary_roles')
      .insertOne({
        userId: new Types.ObjectId(ids.owner),
        roleId: 'INTERNAL_SUPPORT',
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 600000),
      });
    expect((await call('post', base, { purposeId: 'denied-temporary-support' })).status).toBe(403);
    expect(await tickets.countDocuments()).toBe(0);
  });
  it('uses the scoped index and bounded stable pagination, excluding another Organisation', async () => {
    const created = [await create(), await create(), await create()].map((p) => p.ticketId).sort();
    await call('post', base.replace(ids.org, ids.foreign), { purposeId: 'foreign' }, ids.admin);
    const first = await call('get', `${base}?limit=2`);
    expect(first.body.items.map((item: { ticketId: string }) => item.ticketId)).toEqual(
      created.slice(0, 2),
    );
    const next = await call('get', `${base}?limit=2&afterTicketId=${first.body.nextAfterTicketId}`);
    expect(next.body.items.map((item: { ticketId: string }) => item.ticketId)).toEqual(
      created.slice(2),
    );
    expect(next.body.nextAfterTicketId).toBeNull();
    expect(
      (await tickets.collection.indexes()).some(
        (index) => JSON.stringify(index.key) === JSON.stringify({ organizationId: 1, _id: 1 }),
      ),
    ).toBe(true);
    expect((await call('get', '/api/v1/support-tickets')).status).toBe(404);
  });
  it('uses current Owner state and rechecks after the guard before writing', async () => {
    const access = app!.get<SupportTicketAccessPort>(SUPPORT_TICKET_ACCESS);
    const authorize = access.authorize.bind(access);
    jest.spyOn(access, 'authorize').mockImplementationOnce(async (input) => {
      const allowed = await authorize(input);
      await connection
        .collection('organizations')
        .updateOne({ _id: new Types.ObjectId(ids.org) }, { $set: { 'members.0.role': 'MEMBER' } });
      return allowed;
    });
    expect((await call('post', base, { purposeId: 'demoted' })).status).toBe(403);
    expect(await tickets.countDocuments()).toBe(0);
    expect(await connection.collection('audit_logs').countDocuments()).toBe(0);
  });
  it('rejects forged DTO authority and revoked ordinary authentication', async () => {
    expect(
      (
        await call('post', base, {
          purposeId: 'fixture',
          actorId: ids.admin,
          role: 'OWNER',
          organizationId: ids.foreign,
        })
      ).status,
    ).toBe(400);
    await connection
      .collection('user_sessions')
      .updateOne(
        { _id: new Types.ObjectId(sessionId(ids.owner)) },
        { $set: { revokedAt: new Date() } },
      );
    expect((await call('post', base, { purposeId: 'revoked' })).status).toBe(401);
    expect(await tickets.countDocuments()).toBe(0);
    expect(await connection.collection('audit_logs').countDocuments()).toBe(0);
  });
  it('returns lifecycle/stale revision conflicts without an extra audit', async () => {
    const created = await create();
    expect(
      (await call('post', `${base}/${created.ticketId}/reopen`, { expectedRevision: 0 })).status,
    ).toBe(409);
    expect(
      (await call('post', `${base}/${created.ticketId}/close`, { expectedRevision: 0 })).status,
    ).toBe(200);
    expect(
      (await call('post', `${base}/${created.ticketId}/cancel`, { expectedRevision: 0 })).body.code,
    ).toBe('SUPPORT_TICKET_CONFLICT');
    expect(await connection.collection('audit_logs').countDocuments()).toBe(2);
  });
  it.each(['create', 'close'] as const)(
    'returns unconfirmed %s after real commit acknowledgement loss without retry',
    async (action) => {
      const created = action === 'close' ? await create() : undefined;
      const start = connection.startSession.bind(connection);
      const commitCalls = jest.fn();
      const startSpy = jest
        .spyOn(connection, 'startSession')
        .mockImplementationOnce(async (...args) => {
          const session = await start(...args);
          const commit = session.commitTransaction.bind(session);
          jest.spyOn(session, 'commitTransaction').mockImplementationOnce(async () => {
            commitCalls();
            await commit();
            throw Object.assign(new Error('injected acknowledgement loss after real commit'), {
              errorLabels: ['UnknownTransactionCommitResult'],
            });
          });
          return session;
        });
      const response =
        action === 'create'
          ? await call('post', base, { purposeId: 'unconfirmed' })
          : await call('post', `${base}/${created!.ticketId}/close`, { expectedRevision: 0 });
      expect(response.status).toBe(503);
      expect(response.body.code).toBe('SUPPORT_TICKET_OUTCOME_UNCONFIRMED');
      const detail = response.body.details[0];
      expect(detail).toMatchObject({
        organizationId: ids.org,
        mutationCommitted: 'unknown',
        retrySafe: false,
      });
      expect(startSpy).toHaveBeenCalledTimes(1);
      expect(commitCalls).toHaveBeenCalledTimes(1);
      expect((await call('get', `${base}/${detail.resourceId}`)).body.revision).toBe(
        action === 'create' ? 0 : 1,
      );
      expect(await tickets.countDocuments()).toBe(1);
      expect(await connection.collection('audit_logs').countDocuments()).toBe(
        action === 'create' ? 1 : 2,
      );
    },
  );
  it('rolls back the Ticket when the real bound audit participant fails', async () => {
    jest
      .spyOn(MongoAuditRepository.prototype, 'append')
      .mockRejectedValueOnce(new Error('injected audit outage'));
    expect((await call('post', base, { purposeId: 'rollback' })).body.code).toBe(
      'ATOMIC_MUTATION_ABORTED',
    );
    expect(await tickets.countDocuments()).toBe(0);
    expect(await connection.collection('audit_logs').countDocuments()).toBe(0);
  });
  it('preserves disabled Support View in the production application', async () => {
    const response = await call('post', `/api/v1/admin/organizations/${ids.org}/impersonate`, {});
    expect(response.status).toBe(503);
    expect(response.body.code).toBe('SUPPORT_IMPERSONATION_UNAVAILABLE');
    expect(await connection.collection('audit_logs').countDocuments()).toBe(0);
  });
});
