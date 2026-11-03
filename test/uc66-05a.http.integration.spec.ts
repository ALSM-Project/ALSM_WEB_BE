import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request, Response } from 'express';
import { Connection, mongo, Types } from 'mongoose';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest');
import { createOwnedUc66Environment } from './uc66-integration/owned-environment';
import { createUc66TestApp } from './uc66-integration/test-app';
import { seedUc66, uc66Credentials, uc66Ids as ids } from './uc66-integration/seed';
import {
  SUPPORT_CONTEXT_UNIT_OF_WORK,
  SupportContextParticipants,
  SupportContextUnitOfWork,
} from '../src/modules/support/application/support-context.ports';
import { SUPPORT_PROJECT_READER } from '../src/modules/projects/application/support-project-reader.port';
import { DiagnosticReaderFactory } from '../src/shared/application/diagnostic-read.port';
import {
  SUPPORT_INSPECTION,
  SupportInspection,
} from '../src/modules/support/application/support-inspection.port';

const suite = process.env.ALSM_UC66_TEST === 'owned-local-only' ? describe : describe.skip;
suite('UC66-05A real password login, Mongo transactions and two independent HTTP instances', () => {
  jest.setTimeout(60000);
  let owned: Awaited<ReturnType<typeof createOwnedUc66Environment>>;
  let a: Awaited<ReturnType<typeof createUc66TestApp>>, b: typeof a;
  let token: string;
  let claims: { sid: string; sv: string; sub: string };
  let time = Date.now();
  let transmission: { started(): void; gate: Promise<void> } | null = null;
  const clock = { now: () => new Date(time) };
  const orgBase = `/api/v1/support/organizations/${ids.organization}`;
  const oid = (id: string) => new Types.ObjectId(id);
  const http = (app: INestApplication, method: string, path: string, credential = token) =>
    request(app.getHttpServer())[method](path).set('Authorization', `Bearer ${credential}`);
  const get = (path: string) => http(a.app, 'get', path);
  const workspace = (id: string) => `${orgBase}/contexts/${id}/workspace/projects`;
  const login = async (app = a.app) =>
    (
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send(uc66Credentials)
        .expect(200)
    ).body.accessToken as string;
  const enter = async () =>
    (await http(a.app, 'post', `${orgBase}/contexts`).send({}).expect(201)).body.id as string;
  const reads = (id: string) =>
    a.connection
      .collection('audit_logs')
      .find({ action: 'SUPPORT_WORKSPACE_READ', 'metadata.contextId': id })
      .toArray();
  const snapshot = (id: string) =>
    a.connection.collection('support_contexts').findOne({ _id: id as never });
  const recovery = (id?: string, operationId?: string, app = a.app, credential = token) =>
    http(app, 'get', `${orgBase}/recovery`, credential).query({
      ...(id ? { contextId: id } : {}),
      ...(operationId ? { operationId } : {}),
    });
  async function revoke(kind: string, contextId: string) {
    const c = b.connection;
    if (kind === 'role') await c.collection('user_roles').deleteMany({ userId: ids.actor });
    if (kind === 'permission')
      await c.collection('role_permissions').deleteMany({ roleId: 'INTERNAL_SUPPORT' });
    if (kind === 'session')
      await c
        .collection('user_sessions')
        .updateOne({ _id: oid(claims.sid) }, { $set: { revokedAt: new Date() } });
    if (kind === 'account' || kind === 'lock')
      await c
        .collection('users')
        .updateOne(
          { _id: oid(ids.actor) },
          { $set: kind === 'lock' ? { isLocked: true } : { isActive: false } },
        );
    if (kind === 'organization')
      await c
        .collection('organizations')
        .updateOne({ _id: oid(ids.organization) }, { $set: { status: 'SUSPENDED' } });
    if (kind === 'ownership')
      await c
        .collection('projects')
        .updateOne(
          { _id: oid(ids.project) },
          { $set: { organizationId: oid(ids.otherOrganization) } },
        );
    if (kind === 'deletion')
      await c
        .collection('projects')
        .updateOne({ _id: oid(ids.project) }, { $set: { deletedAt: new Date() } });
    if (kind === 'exit')
      await http(b.app, 'post', `${orgBase}/contexts/${contextId}/exit`).send({}).expect(200);
    if (kind === 'idle') time += 15 * 60000;
    if (kind === 'absolute') time += 30 * 60000;
  }
  function loseCommitAcknowledgement(connection: Connection) {
    const original = connection.startSession.bind(connection);
    return jest.spyOn(connection, 'startSession').mockImplementationOnce(async (...args) => {
      const session = await original(...args),
        commit = session.commitTransaction.bind(session);
      session.commitTransaction = async () => {
        await commit();
        throw new mongo.MongoServerError({
          message: 'Owned test: durable commit acknowledgement lost',
          code: 50,
        });
      };
      return session;
    });
  }
  function afterCommit(work: () => Promise<void>) {
    const unit = a.app.get<SupportContextUnitOfWork>(SUPPORT_CONTEXT_UNIT_OF_WORK),
      original = unit.run.bind(unit);
    return jest
      .spyOn(unit, 'run')
      .mockImplementation(
        <T>(id: string, callback: (ports: SupportContextParticipants) => Promise<T>) =>
          original(id, callback).then(async (result) => {
            await work();
            return result;
          }),
      );
  }
  beforeAll(async () => {
    owned = await createOwnedUc66Environment();
    const secret = `owned-only-${owned.database}`;
    a = await createUc66TestApp(owned.uri, secret, clock, (app) =>
      app.use((req: Request, res: Response, next: () => void) => {
        const send = res.send.bind(res);
        res.send = (body?: unknown) => {
          if (
            !transmission ||
            res.statusCode !== 200 ||
            !req.path.includes('/workspace/') ||
            typeof body !== 'string'
          )
            return send(body);
          const current = transmission;
          transmission = null;
          const bytes = Buffer.from(body),
            split = Math.floor(bytes.length / 2);
          res.setHeader('Content-Length', bytes.length);
          res.write(bytes.subarray(0, split));
          current.started();
          void current.gate.then(() => res.end(bytes.subarray(split)));
          return res;
        };
        next();
      }),
    );
    b = await createUc66TestApp(owned.uri, secret, clock);
    expect(a.connection).not.toBe(b.connection);
    expect(a.app.get(SUPPORT_CONTEXT_UNIT_OF_WORK)).not.toBe(
      b.app.get(SUPPORT_CONTEXT_UNIT_OF_WORK),
    );
  });
  beforeEach(async () => {
    await owned.verify();
    time = Date.now();
    transmission = null;
    for (const collection of await owned.connection.db!.listCollections().toArray())
      if (collection.name !== '_uc66_05a_owner')
        await owned.connection.collection(collection.name).deleteMany({});
    await seedUc66(a.connection);
    token = await login();
    claims = a.app.get(JwtService).decode(token);
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await a?.app.close();
    await b?.app.close();
    await owned?.dispose();
  });

  it('uses real password/session login, exact persisted authority, name/email search and 30/15-minute deadlines', async () => {
    await request(a.app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ ...uc66Credentials, password: 'wrong' })
      .expect(401);
    const me = await get('/api/v1/auth/me').expect(200);
    expect(me.body).toMatchObject({
      id: ids.actor,
      roles: ['INTERNAL_SUPPORT'],
      effectivePermissions: ['organizations.impersonate'],
    });
    for (const query of [
      { query: 'UC66 Customer' },
      { query: 'uc66-contact@example.invalid', field: 'email' },
    ]) {
      const result = await get('/api/v1/support/organizations').query(query).expect(200);
      expect(result.body.items[0].id).toBe(ids.organization);
      expect(Object.keys(result.body.items[0]).sort()).toEqual(['id', 'name', 'status', 'type']);
    }
    const id = await enter(),
      row = (await snapshot(id))!;
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(30 * 60000);
    const found = await recovery(id).expect(200);
    expect(
      Date.parse(found.body.context.idleExpiresAt) - Date.parse(found.body.context.lastActivityAt),
    ).toBe(15 * 60000);
    expect(
      await a.connection.collection('user_sessions').countDocuments({ userId: oid(ids.actor) }),
    ).toBe(1);
    expect(
      (await a.connection.collection('organizations').findOne({ _id: oid(ids.organization) }))!
        .members,
    ).toEqual([]);
  });
  it('executes all twelve actual workspace operations and attributes durable audit to original actor/session/scope', async () => {
    const id = await enter();
    for (const [kind, resource] of Object.entries({
      projects: ids.project,
      screens: ids.screen,
      programs: ids.program,
      findings: ids.finding,
      'conversion-logs': ids.job,
      'error-logs': ids.error,
    })) {
      const path = kind === 'projects' ? workspace(id) : `${workspace(id)}/${ids.project}/${kind}`;
      const list = await get(path).expect(200);
      expect(list.body.items.some((item: { id: string }) => item.id === resource)).toBe(true);
      expect((await get(`${path}/${resource}`).expect(200)).body.item.id).toBe(resource);
    }
    const events = await reads(id);
    expect(events).toHaveLength(12);
    for (const event of events)
      expect(event).toMatchObject({
        actorUserId: oid(ids.actor),
        organizationId: oid(ids.organization),
        metadata: { originalSessionId: claims.sid, contextId: id, mode: 'READ_ONLY' },
      });
    expect(new Set(events.map((event) => event.metadata.operationId)).size).toBe(12);
    await http(a.app, 'post', `${orgBase}/contexts/${id}/exit`).send({}).expect(200);
    expect((await snapshot(id))!.state).toBe('EXITED');
    await get(workspace(id)).expect(409);
  });
  it('paginates 25 real Projects across detail requests without skipping or reusing a child cursor', async () => {
    const id = await enter();
    const first = await get(workspace(id)).expect(200);
    await get(`${workspace(id)}/${ids.project}`).expect(200);
    const second = await get(workspace(id)).query({ afterId: first.body.nextAfterId }).expect(200);
    const third = await get(workspace(id)).query({ afterId: second.body.nextAfterId }).expect(200);
    expect([first.body.items.length, second.body.items.length, third.body.items.length]).toEqual([
      10, 10, 5,
    ]);
    expect(first.body.nextAfterId).toBe(first.body.items[9].id);
    expect(second.body.nextAfterId).toBe(second.body.items[9].id);
    expect(third.body.nextAfterId).toBeNull();
    expect(
      new Set(
        [...first.body.items, ...second.body.items, ...third.body.items].map(
          (item: { id: string }) => item.id,
        ),
      ).size,
    ).toBe(25);
  });
  it('denies cross-Organisation/nested ownership and write/upload/convert/retry/export routes', async () => {
    const id = await enter();
    await get(workspace(id).replace(ids.organization, ids.otherOrganization)).expect(404);
    await get(`${workspace(id)}/200000000000000000000002/screens/${ids.screen}`).expect(404);
    for (const method of ['post', 'put', 'patch', 'delete'])
      await http(a.app, method, `${workspace(id)}/${ids.project}/screens/${ids.screen}`)
        .send({ content: 'denied' })
        .expect(404);
    for (const action of ['upload', 'convert', 'retry', 'mapping', 'export', 'download'])
      expect([400, 404]).toContain(
        (await get(`${workspace(id)}/${ids.project}/screens/${ids.screen}/${action}`)).status,
      );
    expect(await reads(id)).toHaveLength(0);
  });
  it('discovers an abandoned context after reload without references, activity, audit writes or deadline extension', async () => {
    const id = await enter(),
      before = await snapshot(id),
      auditCount = await a.connection.collection('audit_logs').countDocuments();
    time += 60000;
    const result = await recovery(undefined, undefined, b.app).expect(200);
    expect(result.body).toMatchObject({
      outcome: 'FOUND',
      usable: true,
      context: { id },
      operation: null,
    });
    expect(await snapshot(id)).toEqual(before);
    expect(await a.connection.collection('audit_logs').countDocuments()).toBe(auditCount);
  });
  it('discovers the active context when terminal history has the same timestamp and a higher UUID', async () => {
    const id = await enter(),
      row = (await snapshot(id))!;
    await a.connection.collection('support_contexts').insertOne({
      ...row,
      _id: 'ffffffff-ffff-4fff-bfff-ffffffffffff' as never,
      state: 'EXITED',
      revision: 2,
      endedAt: new Date(time),
    });
    const result = await recovery().expect(200);
    expect(result.body).toMatchObject({ outcome: 'FOUND', usable: true, context: { id } });
    await http(a.app, 'post', `${orgBase}/contexts/${id}/exit`).send({}).expect(200);
    expect((await recovery().expect(200)).body).toMatchObject({
      outcome: 'UNRESOLVED',
      context: null,
      usable: false,
    });
    expect((await recovery(id).expect(200)).body.context.state).toBe('EXITED');
  });
  it.each(['enter', 'exit', 'workspace'])(
    'reconciles lost %s acknowledgement only from exact durable operation evidence',
    async (operation) => {
      let id = operation === 'enter' ? '' : await enter();
      loseCommitAcknowledgement(a.connection);
      const response =
        operation === 'enter'
          ? await http(a.app, 'post', `${orgBase}/contexts`).send({})
          : operation === 'exit'
            ? await http(a.app, 'post', `${orgBase}/contexts/${id}/exit`).send({})
            : await get(workspace(id));
      expect(response.status).toBe(503);
      const reference = response.body.details[0];
      id = reference.contextId;
      expect(reference).toMatchObject({
        mutationCommitted: 'unknown',
        retrySafe: false,
        operationId: expect.any(String),
      });
      const before = await snapshot(id),
        events = await a.connection.collection('audit_logs').countDocuments();
      const proof = await recovery(id, reference.operationId, b.app).expect(200);
      expect(proof.body.operation).toMatchObject({ id: reference.operationId, state: 'COMMITTED' });
      expect(proof.body.context.state).toBe(operation === 'exit' ? 'EXITED' : 'ACTIVE');
      await recovery(id, reference.operationId).expect(200);
      expect(await snapshot(id)).toEqual(before);
      expect(await a.connection.collection('audit_logs').countDocuments()).toBe(events);
    },
  );
  it('keeps missing evidence unresolved and denies another original session/Organisation without exposing records', async () => {
    const empty = await recovery().expect(200);
    expect(empty.body.outcome).toBe('UNRESOLVED');
    const id = await enter();
    const unknown = '99999999-9999-4999-8999-999999999999';
    await get(`${orgBase}/recovery`).query({ role: 'ADMIN' }).expect(400);
    await get(`${orgBase}/recovery`).send({ readOnly: false }).expect(400);
    expect((await recovery(id, unknown).expect(200)).body.operation.state).toBe('UNRESOLVED');
    await recovery(undefined, unknown).expect(400);
    const otherSessionToken = await login(b.app);
    await recovery(id, undefined, b.app, otherSessionToken).expect(404);
    expect(
      (await recovery(undefined, undefined, b.app, otherSessionToken).expect(200)).body,
    ).toMatchObject({ outcome: 'UNRESOLVED', context: null });
    await get(`${orgBase.replace(ids.organization, ids.otherOrganization)}/recovery`)
      .query({ contextId: id })
      .expect(404);
  });
  it('does not disclose another authorized staff actor’s context or operation evidence', async () => {
    const id = await enter();
    const peerId = new Types.ObjectId();
    const primary = (await a.connection.collection('users').findOne({ _id: oid(ids.actor) }))!;
    await b.connection
      .collection('users')
      .insertOne({ ...primary, _id: peerId, email: 'uc66-peer@example.invalid' });
    await b.connection.collection('user_roles').insertOne({
      userId: peerId.toHexString(),
      roleId: 'INTERNAL_SUPPORT',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const peerToken = (
      await request(b.app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ ...uc66Credentials, email: 'uc66-peer@example.invalid' })
        .expect(200)
    ).body.accessToken as string;
    const event = (await a.connection
      .collection('audit_logs')
      .findOne({ action: 'SUPPORT_CONTEXT_ENTERED', resourceId: id }))!;
    await recovery(id, event.metadata.operationId, b.app, peerToken).expect(404);
    expect(
      (await recovery(undefined, undefined, b.app, peerToken).expect(200)).body.context,
    ).toBeNull();
  });
  it('rechecks expiry after fresh ownership validation and rolls back stale pending activity', async () => {
    const id = await enter();
    const inspection = a.app.get<SupportInspection>(SUPPORT_INSPECTION),
      original = inspection.snapshot.bind(inspection);
    jest
      .spyOn(inspection, 'snapshot')
      .mockImplementation(<T>(work: Parameters<SupportInspection['snapshot']>[0]) =>
        original(work).then((result) => {
          time += 15 * 60000;
          return result as T;
        }),
      );
    await get(`${workspace(id)}/${ids.project}`).expect(409);
    expect(await reads(id)).toHaveLength(0);
    expect((await snapshot(id))!.revision).toBe(1);
  });
  it.each(['idle', 'absolute'])(
    'reports %s expiry without renewing it or admitting workspace activity',
    async (kind) => {
      const id = await enter(),
        before = await snapshot(id);
      await revoke(kind, id);
      expect((await recovery(id).expect(200)).body.usable).toBe(false);
      await get(workspace(id)).expect(409);
      expect(await snapshot(id)).toEqual(before);
      expect(await reads(id)).toHaveLength(0);
    },
  );
  it.each([
    'role',
    'permission',
    'session',
    'account',
    'lock',
    'organization',
    'ownership',
    'deletion',
    'exit',
    'idle',
    'absolute',
  ])(
    'withholds post-commit data after independent-instance %s invalidation while preserving committed audit',
    async (kind) => {
      const id = await enter();
      time += 1000;
      afterCommit(() => revoke(kind, id));
      const result = await get(`${workspace(id)}/${ids.project}`);
      expect([403, 503]).toContain(result.status);
      expect(result.body).toMatchObject({
        code: 'SUPPORT_WORKSPACE_DELIVERY_WITHHELD',
        details: [{ contextId: id, activityCommitted: true, retrySafe: false }],
      });
      expect(result.body).not.toHaveProperty('item');
      expect(await reads(id)).toHaveLength(1);
      const next = await http(b.app, 'get', `${workspace(id)}/${ids.project}`);
      expect([401, 403, 404, 409]).toContain(next.status);
      expect(await reads(id)).toHaveLength(1);
    },
  );
  it.each([
    'role',
    'permission',
    'session',
    'account',
    'lock',
    'organization',
    'ownership',
    'deletion',
    'exit',
    'idle',
    'absolute',
  ])(
    'fences pre-commit %s invalidation from another instance without an orphan READ audit',
    async (kind) => {
      const id = await enter(),
        factory = a.app.get<DiagnosticReaderFactory>(SUPPORT_PROJECT_READER),
        bind = factory.bind.bind(factory);
      let observed = false;
      jest.spyOn(factory, 'bind').mockImplementation((handle) => {
        const reader = bind(handle);
        return {
          read: async (query) => {
            const rows = await reader.read(query);
            if (!observed) {
              observed = true;
              await revoke(kind, id);
            }
            return rows;
          },
        };
      });
      const result = await get(`${workspace(id)}/${ids.project}`);
      expect([401, 403, 404, 409]).toContain(result.status);
      expect(await reads(id)).toHaveLength(0);
      expect((await snapshot(id))!.revision).toBe(kind === 'exit' ? 2 : 1);
    },
  );
  it('allows already-started response transmission to complete and denies subsequent requests after role revocation', async () => {
    const id = await enter();
    let started!: () => void, release!: () => void;
    const began = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    transmission = { started, gate };
    const response = Promise.resolve(get(`${workspace(id)}/${ids.project}`));
    try {
      await began;
      await revoke('role', id);
    } finally {
      release();
    }
    expect((await response).status).toBe(200);
    await http(b.app, 'get', workspace(id)).expect(403);
    expect(await reads(id)).toHaveLength(1);
  });
});
