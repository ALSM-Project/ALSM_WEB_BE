import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Connection, createConnection, Model, Types, mongo } from 'mongoose';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest');
import { USER_REPOSITORY } from '../src/modules/users/domain/user.repository';
import { SESSION_REPOSITORY } from '../src/modules/auth/domain/session.repository';
import { RbacSeedService } from '../src/modules/rbac/application/rbac-seed.service';
import { CONVERSION_QUEUE } from '../src/modules/conversions/domain/conversion-job.types';
import { VALIDATION_QUEUE } from '../src/modules/validation/domain/validation-queue.port';
import { SUPPORT_TICKET_ACCESS } from '../src/modules/support/application/support-ticket-access.port';
import {
  SUPPORT_TICKET_REPOSITORY,
  SupportTicketRepository,
} from '../src/modules/support/domain/support-ticket.repository';
import { CUSTOMER_CONSENT_REPOSITORY } from '../src/modules/support/domain/customer-consent.repository';
import { MongoCustomerConsentRepository } from '../src/modules/support/infrastructure/mongo-customer-consent.repository';
import {
  CUSTOMER_CONSENT_MODEL,
  CustomerConsentSchema,
  CustomerConsentSnapshot,
} from '../src/modules/support/infrastructure/customer-consent.schema';
import { CustomerConsentController } from '../src/modules/support/presentation/customer-consent.controller';
import { AuditLog } from '../src/modules/audit/infrastructure/audit-log.schema';
import { MongoAuditRepository } from '../src/modules/audit/infrastructure/mongo-audit.repository';
import { ApiExceptionFilter } from '../src/shared/errors/api-exception.filter';
import { consentIds, consentTicketFixture } from './customer-consent.fixtures';
import {
  persistedConsentFixture,
  consentAuditFixture,
} from './customer-consent.persistence.fixtures';
import { ticketRaceBarrier } from './support-ticket-race-barrier';
import {
  createConsentHttpFixture,
  consentHttpBase as base,
  consentHttpSecret,
  consentHttpSession,
  consentHttpRequestBody,
  consentHttpDeclineBody,
  consentHttpStatusQuery,
} from './customer-consent-api.fixtures';

const owned =
  process.env.ALSM_SUPPORT_TICKET_TEST === 'owned-local-only' ? describe : describe.skip;
// Consent HTTP is explicitly isolated. Production AppModule supplies real persisted
// auth/Owner/Ticket adapters but has no Consent routes/providers. Authority is synthetic.
owned('Isolated Consent HTTP with real MongoDB and unchanged production routing', () => {
  const runId = randomUUID().replaceAll('-', ''),
    database = `alsm_consent_api_${runId}`;
  const uri = `mongodb://127.0.0.1:27127/${database}?replicaSet=alsmPriorities&directConnection=true`;
  const originalEnvironment = { ...process.env };
  const ids = {
    owner: consentIds.actor,
    org: consentIds.organization,
    staff: consentIds.beneficiary,
    foreign: consentIds.foreignOrganization,
    member: '888888888888888888888888',
    admin: '999999999999999999999999',
  };
  let production: INestApplication, ownership: Connection, connection: Connection;
  let h: Awaited<ReturnType<typeof createConsentHttpFixture>>;
  let consents: Model<CustomerConsentSnapshot>,
    audits: Model<AuditLog>,
    repo: MongoCustomerConsentRepository,
    tickets: SupportTicketRepository;
  let marked = false;
  let defaultAuthority: NonNullable<
    ReturnType<typeof h.f.authority.authorize.getMockImplementation>
  >;
  const evidence: Record<string, unknown> = {
    runId,
    database,
    replicaSet: 'alsmPriorities',
    consentProductionRegistered: false,
    authority: 'SYNTHETIC_TEST_ONLY',
    highAvailabilityCertified: false,
    observations: [],
  };
  const observations = evidence.observations as unknown[];
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
  const sessionId = (actor: string) =>
    actor === ids.owner ? consentHttpSession : actor.slice(0, -1) + '7';
  const bearer = (actor = ids.owner) =>
    h.token({
      sub: actor,
      sid: sessionId(actor),
      isPlatformAdmin: actor === ids.admin,
      role: 'OWNER',
      personId: 'forged-jwt-person',
    });
  const call = (method: 'get' | 'post', suffix = '', body?: object, actor = ids.owner) => {
    let op = request(h.app.getHttpServer())
      [method](base + suffix)
      .set('Authorization', `Bearer ${bearer(actor)}`);
    if (method === 'get') op = op.query(consentHttpStatusQuery());
    return body ? op.send(body) : op;
  };
  const consentAudits = (id?: string) =>
    audits
      .find({ resourceType: 'CUSTOMER_CONSENT', ...(id ? { resourceId: id } : {}) })
      .lean()
      .exec();
  async function created() {
    const r = await call('post', '', consentHttpRequestBody());
    expect(r.status).toBe(201);
    const id: string = r.body.consentId;
    h.approve('STATUS', `status:${id}`, id);
    h.approve('DECLINE', 'decline-1', id);
    return id;
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
    await ownership.collection('_consent_api_test_owner').insertOne({ runId, database });
    marked = true;
    Object.assign(process.env, {
      NODE_ENV: 'test',
      MONGODB_URI: uri,
      REDIS_HOST: '127.0.0.1',
      JWT_ACCESS_SECRET: consentHttpSecret,
      JWT_REFRESH_SECRET: consentHttpSecret,
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
    production = module.createNestApplication({ logger: false });
    production.setGlobalPrefix('api/v1');
    production.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    production.useGlobalFilters(new ApiExceptionFilter());
    await production.init();
    connection = production.get(getConnectionToken());
    expect(connection.name).toBe(database);
    tickets = production.get(SUPPORT_TICKET_REPOSITORY);
    audits = production.get(getModelToken(AuditLog.name));
    consents = connection.model<CustomerConsentSnapshot>(
      CUSTOMER_CONSENT_MODEL,
      CustomerConsentSchema,
    );
    await consents.createCollection();
    await consents.createIndexes();
    repo = new MongoCustomerConsentRepository(consents, (session, selected) =>
      new MongoAuditRepository(audits).inTransaction(session, selected),
    );
    h = await createConsentHttpFixture([
      { token: USER_REPOSITORY, value: production.get(USER_REPOSITORY) },
      { token: SESSION_REPOSITORY, value: production.get(SESSION_REPOSITORY) },
      { token: SUPPORT_TICKET_ACCESS, value: production.get(SUPPORT_TICKET_ACCESS) },
      { token: SUPPORT_TICKET_REPOSITORY, value: tickets },
      { token: CUSTOMER_CONSENT_REPOSITORY, value: repo },
    ]);
    defaultAuthority = h.f.authority.authorize.getMockImplementation()!;
    evidence.indexes = await consents.collection.indexes();
  }, 30000);
  beforeEach(async () => {
    jest.restoreAllMocks();
    h.intents.clear();
    h.approve('REQUEST', 'request-1');
    h.f.authority.authorize.mockReset().mockImplementation(defaultAuthority);
    for (const name of [
      'users',
      'user_sessions',
      'organizations',
      'user_roles',
      'temporary_roles',
      'support_tickets',
      'customer_consents',
      'audit_logs',
    ])
      await connection.collection(name).deleteMany({});
    const actors = [ids.owner, ids.member, ids.staff, ids.admin];
    await connection.collection('users').insertMany(
      actors.map((actor) => ({
        _id: new Types.ObjectId(actor),
        email: `${actor}@example.invalid`,
        fullName: 'Owned E3 fixture',
        isActive: true,
        isLocked: false,
        isEmailVerified: true,
        mustChangePassword: false,
        isPlatformAdmin: actor === ids.admin,
      })),
    );
    await connection.collection('user_sessions').insertMany(
      actors.map((actor) => ({
        _id: new Types.ObjectId(sessionId(actor)),
        userId: new Types.ObjectId(actor),
        tokenId: randomUUID(),
        refreshTokenHash: 'synthetic-not-a-credential',
        accessVersion: 'v1',
        expiresAt: new Date(Date.now() + 600000),
      })),
    );
    await connection.collection('organizations').insertMany([
      {
        _id: new Types.ObjectId(ids.org),
        name: 'Owned E3 fixture',
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
        name: 'Foreign E3 fixture',
        type: 'ENTERPRISE',
        status: 'ACTIVE',
        members: [{ userId: new Types.ObjectId(ids.admin), role: 'OWNER' }],
      },
    ]);
    await connection
      .collection('user_roles')
      .insertOne({ userId: ids.staff, roleId: 'INTERNAL_SUPPORT' });
    await tickets.create(consentTicketFixture());
  });
  afterAll(async () => {
    try {
      jest.restoreAllMocks();
      if (ownership && marked) {
        verifyContainer();
        expect(ownership.name).toBe(database);
        expect(
          await ownership.collection('_consent_api_test_owner').findOne({ runId, database }),
        ).toBeTruthy();
        await ownership.dropDatabase();
        evidence.databaseDropped = true;
      }
    } finally {
      if (h) await h.app.close();
      if (production) await production.close();
      if (ownership) await ownership.close();
      process.env = originalEnvironment;
      const directory = resolve(process.cwd(), 'coverage', 'customer-consent-api');
      mkdirSync(directory, { recursive: true });
      const path = resolve(directory, `${runId}.json`);
      writeFileSync(path, JSON.stringify(evidence, null, 2));
      console.log(`CONSENT_API_EVIDENCE ${path}`);
    }
  });
  it('keeps all three Consent endpoints absent from production AppModule and preserves impersonation 503', async () => {
    for (const [method, suffix, body] of [
      ['post', '', consentHttpRequestBody()],
      ['get', `/${consentIds.consent}`, undefined],
      ['post', `/${consentIds.consent}/decline`, consentHttpDeclineBody()],
    ] as const) {
      expect(
        (
          await request(production.getHttpServer())
            [method](base + suffix)
            .set('Authorization', `Bearer ${bearer()}`)
            .send(body)
        ).status,
      ).toBe(404);
    }
    expect(() => production.get(CustomerConsentController)).toThrow();
    expect(() => production.get(CUSTOMER_CONSENT_REPOSITORY)).toThrow();
    const denied = await request(production.getHttpServer())
      .post(`/api/v1/admin/organizations/${ids.org}/impersonate`)
      .set('Authorization', `Bearer ${bearer()}`)
      .send({});
    expect(denied.status).toBe(503);
    expect(denied.body.code).toBe('SUPPORT_IMPERSONATION_UNAVAILABLE');
    expect(await consents.countDocuments()).toBe(0);
  });
  it('uses persisted auth/Owner checks and commits pending Consent with exact real audit in the isolated controller', async () => {
    const id = await created(),
      stored = (await repo.findById(id, ids.org, consentIds.ticket))!.toProps();
    expect(stored).toMatchObject({
      state: 'PENDING_VERIFICATION',
      revision: 0,
      createdByUserId: ids.owner,
      grantor: { personId: 'customer-owner-person', accountId: ids.owner },
    });
    const entries = await consentAudits(id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actorUserId: new Types.ObjectId(ids.owner),
      organizationId: new Types.ObjectId(ids.org),
      action: 'CUSTOMER_CONSENT_REQUESTED',
      metadata: {
        ticketId: consentIds.ticket,
        episodeId: consentIds.episode,
        revision: '0',
        sourceEventId: 'request-1',
      },
    });
    const status = await call('get', `/${id}`);
    expect(status.status).toBe(200);
    expect(Object.keys(status.body).sort()).toEqual(
      [
        'consentId',
        'organizationId',
        'ticketId',
        'episodeId',
        'state',
        'revision',
        'operationalAccess',
        'ticketCompatibility',
      ].sort(),
    );
    expect(status.body.operationalAccess).toBe(false);
    expect(JSON.stringify(status.body)).not.toMatch(
      /source|policy|provenance|grantor|beneficiary|credential/,
    );
    observations.push({
      case: 'isolated-http-pending',
      consentId: id,
      state: stored.state,
      revision: stored.revision,
      auditCount: entries.length,
    });
  });
  it('commits a verified original-grantor decline with immutable history and exact audit revisions', async () => {
    const id = await created(),
      original = (await repo.findById(id, ids.org, consentIds.ticket))!.toProps();
    const response = await call('post', `/${id}/decline`, consentHttpDeclineBody());
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      state: 'DECLINED',
      revision: 1,
      operationalAccess: false,
    });
    const stored = (await repo.findById(id, ids.org, consentIds.ticket))!.toProps();
    expect(stored.history[0]).toEqual(original.history[0]);
    const entries = await consentAudits(id);
    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.action === 'CUSTOMER_CONSENT_DECLINED')).toMatchObject({
      actorUserId: new Types.ObjectId(ids.owner),
      metadata: { revision: '1', expectedRevision: '0', sourceEventId: 'decline-1' },
    });
  });
  it.each([ids.member, ids.staff, ids.admin])(
    'denies persisted member/staff/Admin %s on all three routes',
    async (actor) => {
      for (const [method, suffix, body] of [
        ['post', '', consentHttpRequestBody()],
        ['get', `/${consentIds.consent}`, undefined],
        ['post', `/${consentIds.consent}/decline`, consentHttpDeclineBody()],
      ] as const)
        expect((await call(method, suffix, body, actor)).status).toBe(403);
      expect(h.f.authority.authorize).not.toHaveBeenCalled();
      expect(await consents.countDocuments()).toBe(0);
    },
  );
  it.each(['inactive', 'locked', 'revoked', 'expired', 'stale-version'] as const)(
    'denies real persisted %s account/session',
    async (condition) => {
      if (condition === 'inactive' || condition === 'locked')
        await connection
          .collection('users')
          .updateOne(
            { _id: new Types.ObjectId(ids.owner) },
            { $set: condition === 'inactive' ? { isActive: false } : { isLocked: true } },
          );
      else
        await connection.collection('user_sessions').updateOne(
          { _id: new Types.ObjectId(consentHttpSession) },
          {
            $set:
              condition === 'revoked'
                ? { revokedAt: new Date() }
                : condition === 'expired'
                  ? { expiresAt: new Date(0) }
                  : { accessVersion: 'v2' },
          },
        );
      expect((await call('post', '', consentHttpRequestBody())).status).toBe(401);
      expect(await consents.countDocuments()).toBe(0);
    },
  );
  it('keeps foreign and missing Consent indistinguishable through exact scoped reads', async () => {
    const foreign = persistedConsentFixture({ organizationId: ids.foreign });
    expect(await repo.create(foreign, consentAuditFixture(foreign))).toBe('CONFIRMED');
    for (const id of [foreign.toProps().consentId, consentIds.consent]) {
      h.approve('STATUS', `status:${id}`, id);
      const r = await call('get', `/${id}`);
      expect(r.status).toBe(404);
      expect(r.body.code).toBe('CUSTOMER_CONSENT_NOT_FOUND');
      expect(JSON.stringify(r.body)).not.toContain(ids.foreign);
    }
  });
  it('rejects a foreign Ticket and cross-Organisation route without database effects', async () => {
    const foreignPath = base.replace(ids.org, ids.foreign);
    expect(
      (
        await request(h.app.getHttpServer())
          .post(foreignPath)
          .set('Authorization', `Bearer ${bearer()}`)
          .send(consentHttpRequestBody())
      ).status,
    ).toBe(403);
    await connection
      .collection<{ _id: string; organizationId: Types.ObjectId }>('support_tickets')
      .updateOne(
        { _id: consentIds.ticket },
        { $set: { organizationId: new Types.ObjectId(ids.foreign) } },
      );
    expect((await call('post', '', consentHttpRequestBody())).status).toBe(404);
    expect(await consents.countDocuments()).toBe(0);
  });
  it('does not infer independent authority from a valid persisted Owner or source/checkbox claims', async () => {
    h.intents.clear();
    expect((await call('post', '', consentHttpRequestBody())).status).toBe(403);
    expect((await call('post', '', { ...consentHttpRequestBody(), verified: true })).status).toBe(
      400,
    );
    expect(await consents.countDocuments()).toBe(0);
    expect(await consentAudits()).toHaveLength(0);
  });
  it('rejects revoked Owner membership after the trusted-intent await', async () => {
    h.f.authority.authorize.mockImplementationOnce(async (r) => {
      await connection.collection('organizations').updateOne({ _id: new Types.ObjectId(ids.org) }, {
        $pull: { members: { userId: new Types.ObjectId(ids.owner) } },
      } as never);
      return defaultAuthority(r);
    });
    expect((await call('post', '', consentHttpRequestBody())).status).toBe(403);
    expect(await consents.countDocuments()).toBe(0);
  });
  it('rejects a Ticket episode change during independent verification', async () => {
    h.f.authority.authorize.mockImplementationOnce(async (r) => {
      const t = (await tickets.findById(consentIds.ticket, ids.org))!;
      t.close(ids.owner, new Date());
      expect(await tickets.save(t, 0)).toBe(true);
      t.reopen(ids.owner, new Date(), consentIds.nextEpisode);
      expect(await tickets.save(t, 1)).toBe(true);
      return defaultAuthority(r);
    });
    expect((await call('post', '', consentHttpRequestBody())).status).toBe(409);
    expect(await consents.countDocuments()).toBe(0);
  });
  it('rolls back real Consent and audit when the session-bound audit append fails', async () => {
    const original = MongoAuditRepository.prototype.append;
    jest.spyOn(MongoAuditRepository.prototype, 'append').mockImplementationOnce(async function (
      this: MongoAuditRepository,
      input,
    ) {
      await original.call(this, input);
      throw new Error('TEST after audit insert');
    });
    const r = await call('post', '', consentHttpRequestBody());
    expect(r.status).toBe(503);
    expect(await consents.countDocuments()).toBe(0);
    expect(await consentAudits()).toHaveLength(0);
    observations.push({ case: 'http-audit-rollback', consentCount: 0, auditCount: 0 });
  });
  it('rolls back a real Consent write failure before audit without an orphan event', async () => {
    const collection = connection.collection<CustomerConsentSnapshot>('customer_consents');
    const insert = collection.insertOne.bind(collection);
    jest.spyOn(collection, 'insertOne').mockImplementationOnce(async (...args) => {
      await insert(...args);
      throw new Error('TEST after Consent insert');
    });
    expect((await call('post', '', consentHttpRequestBody())).status).toBe(503);
    expect(await consents.countDocuments()).toBe(0);
    expect(await consentAudits()).toHaveLength(0);
    observations.push({ case: 'http-consent-rollback', consentCount: 0, auditCount: 0 });
  });
  it('returns a safe source-event conflict without creating a second record or audit', async () => {
    await created();
    const duplicate = await call('post', '', consentHttpRequestBody());
    expect(duplicate.status).toBe(409);
    expect(await consents.countDocuments()).toBe(1);
    expect(await consentAudits()).toHaveLength(1);
  });
  it.each(['request', 'decline'] as const)(
    'returns unconfirmed HTTP %s after a real commit with no business replay',
    async (operation) => {
      const id = operation === 'decline' ? await created() : undefined;
      const collection = connection.collection<CustomerConsentSnapshot>('customer_consents');
      const writes =
        operation === 'request'
          ? jest.spyOn(collection, 'insertOne')
          : jest.spyOn(collection, 'updateOne');
      const append = jest.spyOn(MongoAuditRepository.prototype, 'append'),
        start = connection.startSession.bind(connection),
        commits = jest.fn(),
        conveniences = jest.fn();
      const starts = jest
        .spyOn(connection, 'startSession')
        .mockImplementationOnce(async (...args) => {
          const s = await start(...args),
            commit = s.commitTransaction.bind(s);
          jest.spyOn(s, 'withTransaction').mockImplementation(async () => {
            conveniences();
            throw new Error('TEST callback replay forbidden');
          });
          jest.spyOn(s, 'commitTransaction').mockImplementationOnce(async () => {
            commits();
            await commit();
            throw new mongo.MongoServerError({
              message: 'TEST acknowledgement lost',
              code: 50,
              errorLabels: ['UnknownTransactionCommitResult', 'TransientTransactionError'],
            });
          });
          return s;
        });
      const r =
        operation === 'request'
          ? await call('post', '', consentHttpRequestBody())
          : await call('post', `/${id}/decline`, consentHttpDeclineBody());
      expect(r.status).toBe(503);
      expect(r.body.code).toBe('CUSTOMER_CONSENT_OUTCOME_UNCONFIRMED');
      expect(r.body.details[0]).toMatchObject({
        organizationId: ids.org,
        ticketId: consentIds.ticket,
        episodeId: consentIds.episode,
        mutationCommitted: 'unknown',
        retrySafe: false,
        revision: operation === 'decline' ? 1 : 0,
        expectedRevision: operation === 'decline' ? 0 : null,
      });
      if (id) expect(r.body.details[0].consentId).toBe(id);
      const stored = (await repo.findById(
        r.body.details[0].consentId,
        ids.org,
        consentIds.ticket,
      ))!.toProps();
      expect(stored.revision).toBe(operation === 'decline' ? 1 : 0);
      expect(writes).toHaveBeenCalledTimes(1);
      expect(append).toHaveBeenCalledTimes(1);
      expect(starts).toHaveBeenCalledTimes(1);
      expect(commits).toHaveBeenCalledTimes(1);
      expect(conveniences).not.toHaveBeenCalled();
      expect(await consentAudits(stored.consentId)).toHaveLength(operation === 'decline' ? 2 : 1);
      observations.push({
        case: 'http-post-commit-ack-loss',
        operation,
        consentId: stored.consentId,
        revision: stored.revision,
        httpStatus: r.status,
        businessWrites: writes.mock.calls.length,
        auditWrites: append.mock.calls.length,
        commitCalls: commits.mock.calls.length,
        convenienceCalls: conveniences.mock.calls.length,
      });
    },
  );
  it('overlaps two HTTP declines in distinct real snapshot sessions with one audited winner', async () => {
    const id = await created();
    h.approve('DECLINE', 'decline-2', id);
    const collection = connection.collection<CustomerConsentSnapshot>('customer_consents'),
      update = collection.updateOne.bind(collection);
    const barrier = ticketRaceBarrier({
      ticketId: consentIds.ticket,
      organizationId: ids.org,
      revision: 0,
    });
    const sessions: { participant: string; lsid: string; transaction: string }[] = [];
    let calls = 0;
    const spy = jest
      .spyOn(collection, 'updateOne')
      .mockImplementation(async (filter, change, options) => {
        const session = options?.session;
        if (!session) throw new Error('Missing race session');
        expect(filter).toMatchObject({ _id: id, episodeId: consentIds.episode, revision: 0 });
        const p = await consents.findOne({ _id: id }).session(session).lean().exec();
        if (!p) throw new Error('Missing race Consent');
        const participant = calls++ === 0 ? 'left' : 'right';
        sessions.push({
          participant,
          lsid: session.id!.id.toString('hex'),
          transaction: String(session.serverSession?.txnNumber),
        });
        await barrier.arrive({
          participant,
          session,
          ticketId: p.ticketId,
          organizationId: String(p.organizationId),
          revision: p.revision,
        });
        return update(filter, change, options);
      });
    try {
      const results = await Promise.all([
        call('post', `/${id}/decline`, consentHttpDeclineBody()),
        call('post', `/${id}/decline`, consentHttpDeclineBody('decline-2')),
      ]);
      barrier.assertReady();
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(spy).toHaveBeenCalledTimes(2);
      expect(sessions[0].lsid).not.toBe(sessions[1].lsid);
      const stored = (await repo.findById(id, ids.org, consentIds.ticket))!.toProps();
      expect(stored.state).toBe('DECLINED');
      expect(stored.revision).toBe(1);
      const winnerSource = results[0].status === 200 ? 'decline-1' : 'decline-2',
        loserSource = results[0].status === 409 ? 'decline-1' : 'decline-2';
      const entries = await consentAudits(id);
      expect(entries).toHaveLength(2);
      expect(entries.some((e) => e.metadata?.sourceEventId === loserSource)).toBe(false);
      expect(entries.find((e) => e.metadata?.revision === '1')).toMatchObject({
        actorUserId: new Types.ObjectId(ids.owner),
        metadata: { sourceEventId: winnerSource, expectedRevision: '0' },
      });
      expect(stored.history[1].source.evidenceId).toBe(winnerSource);
      observations.push({
        case: 'http-competing-declines',
        consentId: id,
        expectedRevision: 0,
        sessions,
        httpStatuses: results.map((r) => r.status),
        storedRevision: stored.revision,
        winnerSource,
        losingAuditCount: 0,
        auditCount: entries.length,
      });
    } finally {
      barrier.cancel();
      spy.mockRestore();
    }
  });
  it('rejects corrupted VERIFIED_GRANTED from the real database without exposing claims', async () => {
    const id = await created();
    await connection
      .collection('customer_consents')
      .updateOne({ _id: id } as never, { $set: { state: 'VERIFIED_GRANTED' } });
    const r = await call('get', `/${id}`);
    expect(r.status).toBe(503);
    expect(r.body.code).toBe('CUSTOMER_CONSENT_SNAPSHOT_INVALID');
    expect(await consentAudits(id)).toHaveLength(1);
  });
});
