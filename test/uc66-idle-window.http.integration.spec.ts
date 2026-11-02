// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest');
import { createOwnedUc66Environment } from './uc66-integration/owned-environment';
import { createUc66TestApp } from './uc66-integration/test-app';
import { seedUc66, uc66Credentials, uc66Ids as ids } from './uc66-integration/seed';
import {
  TRANSACTIONAL_AUDIT_FACTORY,
  TransactionalAuditFactory,
} from '../src/modules/audit/domain/transactional-audit.port';
import { SUPPORT_CONTEXT_POLICY } from '../src/modules/support/domain/support-context.entity';

const suite = process.env.ALSM_UC66_TEST === 'owned-local-only' ? describe : describe.skip;
type Activity = 'workspace' | 'status';
const activities: Activity[] = ['workspace', 'status'];

suite('P2-01 original committed idle window (real Mongo and authenticated HTTP)', () => {
  jest.setTimeout(60000);
  let owned: Awaited<ReturnType<typeof createOwnedUc66Environment>>;
  let instance: Awaited<ReturnType<typeof createUc66TestApp>>;
  let start: number,
    time: number,
    token: string,
    wallClock = false;
  const clock = { now: () => new Date(wallClock ? Date.now() : time) };
  const base = `/api/v1/support/organizations/${ids.organization}`;
  const call = (method: 'get' | 'post', path: string) =>
    request(instance.app.getHttpServer())[method](path).set('Authorization', `Bearer ${token}`);
  const project = (id: string) => `${base}/contexts/${id}/workspace/projects/${ids.project}`;
  const read = (kind: Activity, id: string) =>
    call('get', kind === 'workspace' ? project(id) : `${base}/contexts/${id}`);
  const snapshot = (id: string) =>
    instance.connection.collection('support_contexts').findOne({ _id: id as never });
  const readAudits = (id: string) =>
    instance.connection.collection('audit_logs').countDocuments({
      'metadata.contextId': id,
      action: { $in: ['SUPPORT_WORKSPACE_READ', 'SUPPORT_CONTEXT_READ'] },
    });

  beforeAll(async () => {
    owned = await createOwnedUc66Environment();
    time = Date.now();
    instance = await createUc66TestApp(owned.uri, 'owned-idle-window-regression-only', clock);
  });
  beforeEach(async () => {
    await owned.verify();
    wallClock = false;
    start = time = Date.now();
    for (const collection of await owned.connection.db!.listCollections().toArray())
      if (collection.name !== '_uc66_05a_owner')
        await owned.connection.collection(collection.name).deleteMany({});
    await seedUc66(instance.connection);
    token = (
      await request(instance.app.getHttpServer())
        .post('/api/v1/auth/login')
        .send(uc66Credentials)
        .expect(200)
    ).body.accessToken as string;
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await instance?.app.close();
    await owned?.dispose();
  });

  async function enter() {
    return (await call('post', `${base}/contexts`).send({}).expect(201)).body.id as string;
  }
  /** Delay only after the REAL READ audit insert in the REAL pending transaction. */
  function afterPendingAudit(kind: Activity, delay: () => Promise<void>) {
    const factory = instance.app.get<TransactionalAuditFactory>(TRANSACTIONAL_AUDIT_FACTORY);
    const bind = factory.bind.bind(factory);
    const action = kind === 'workspace' ? 'SUPPORT_WORKSPACE_READ' : 'SUPPORT_CONTEXT_READ';
    let pauses = 0;
    jest.spyOn(factory, 'bind').mockImplementation((transaction) => {
      const audit = bind(transaction);
      return {
        append: async (event) => {
          await audit.append(event);
          if (event.action === action && pauses === 0) {
            pauses++;
            await delay();
          }
        },
      };
    });
    return () => pauses;
  }
  async function expectExpiredPending(
    id: string,
    before: NonNullable<Awaited<ReturnType<typeof snapshot>>>,
    auditCount: number,
    response: { status: number; body: Record<string, unknown> },
  ) {
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('SUPPORT_CONTEXT_INACTIVE');
    for (const field of ['item', 'items', 'id', 'operationId'])
      expect(response.body).not.toHaveProperty(field);
    // Includes revision, lastActivityAt, absolute expiry, lifecycle and bindings.
    expect(await snapshot(id)).toEqual(before);
    expect(await readAudits(id)).toBe(auditCount);
    const recovery = await call('get', `${base}/recovery`).query({ contextId: id }).expect(200);
    expect(recovery.body.usable).toBe(false);
    expect(await snapshot(id)).toEqual(before);
    await call('get', project(id)).expect(409);
    expect(await snapshot(id)).toEqual(before);
    expect(await readAudits(id)).toBe(auditCount);
  }

  it.each(activities)(
    '%s rolls pending activity and audit back after the original idle deadline',
    async (kind) => {
      const id = await enter(),
        before = (await snapshot(id))!;
      time = start + 14 * 60000 + 59000;
      const paused = afterPendingAudit(kind, async () => {
        time += 2000;
      });
      const response = await read(kind, id);
      expect(paused()).toBe(1);
      await expectExpiredPending(id, before, 0, response);
    },
  );

  it.each(activities)('%s fails closed at exact original idle-deadline equality', async (kind) => {
    const id = await enter(),
      before = (await snapshot(id))!;
    time = start + 14 * 60000 + 59000;
    const paused = afterPendingAudit(kind, async () => {
      time += 1000;
    });
    const response = await read(kind, id);
    expect(paused()).toBe(1);
    await expectExpiredPending(id, before, 0, response);
  });

  it.each(activities)(
    '%s committed before the original deadline renews idle but never absolute expiry',
    async (kind) => {
      const id = await enter(),
        before = (await snapshot(id))!;
      time = start + 14 * 60000 + 59000;
      const activityAt = new Date(time);
      const paused = afterPendingAudit(kind, async () => {
        time += 500;
      });
      const response = await read(kind, id);
      expect(response.status).toBe(200);
      expect(paused()).toBe(1);
      if (kind === 'workspace') expect(response.body.item.id).toBe(ids.project);
      else expect(response.body.id).toBe(id);
      const committed = (await snapshot(id))!;
      expect(committed.revision).toBe(before.revision + 1);
      expect(committed.lastActivityAt).toEqual(activityAt);
      expect(committed.expiresAt).toEqual(before.expiresAt);
      expect(await readAudits(id)).toBe(1);
      // A fresh request uses the newly COMMITTED window, not the earlier snapshot.
      time = start + 16 * 60000;
      await call('get', project(id)).expect(200);
      expect((await snapshot(id))!.expiresAt).toEqual(before.expiresAt);
    },
  );

  it.each(activities)('%s still rejects absolute expiry after pending activity', async (kind) => {
    const id = await enter();
    for (const minute of [14, 28]) {
      time = start + minute * 60000;
      await read(kind, id).expect(200);
    }
    const before = (await snapshot(id))!,
      count = await readAudits(id);
    time = start + 29 * 60000 + 59000;
    const paused = afterPendingAudit(kind, async () => {
      time += 2000;
    });
    const response = await read(kind, id);
    expect(paused()).toBe(1);
    await expectExpiredPending(id, before, count, response);
  });

  it.each(activities)(
    '%s rejects a real five-second pending delay across the original idle deadline',
    async (kind) => {
      const id = await enter();
      // Age only the owned fixture. Runtime admission/commit checks use real Date.now().
      const aged = Date.now() - (SUPPORT_CONTEXT_POLICY.idleTimeoutMs - 3000);
      await instance.connection.collection('support_contexts').updateOne(
        { _id: id as never },
        {
          $set: {
            createdAt: new Date(aged),
            lastActivityAt: new Date(aged),
            expiresAt: new Date(aged + SUPPORT_CONTEXT_POLICY.absoluteLifetimeMs),
          },
        },
      );
      const before = (await snapshot(id))!;
      wallClock = true;
      const paused = afterPendingAudit(
        kind,
        () => new Promise((resolve) => setTimeout(resolve, 5000)),
      );
      const response = await read(kind, id);
      expect(paused()).toBe(1);
      expect(Date.now()).toBeGreaterThanOrEqual(aged + SUPPORT_CONTEXT_POLICY.idleTimeoutMs);
      await expectExpiredPending(id, before, 0, response);
    },
  );
});
