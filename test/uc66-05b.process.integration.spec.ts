import { ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Types } from 'mongoose';
import { createOwnedUc66Environment } from './uc66-integration/owned-environment';
import { createUc66TestApp } from './uc66-integration/test-app';
import { seedUc66, uc66Credentials, uc66Ids as ids } from './uc66-integration/seed';
import { SupportContextSchema } from '../src/modules/support/infrastructure/support-context.schema';

interface Reply {
  type: string;
  port: number;
  pid: number;
  businessCallbacks: number;
  message?: string;
}
function waitFor(child: ChildProcess, type: string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error(`Owned process timed out: ${type}`)), 40000);
    const onMessage = (message: Reply) => {
      if (message.type === 'error') finish(new Error(message.message));
      else if (message.type === type) finish(null, message);
    };
    const onExit = () => finish(new Error(`Owned process exited before ${type}`));
    function finish(error: Error | null, message?: Reply) {
      clearTimeout(timer);
      child.off('message', onMessage);
      child.off('exit', onExit);
      if (error) reject(error);
      else resolve(message!);
    }
    child.on('message', onMessage);
    child.on('exit', onExit);
  });
}
const suite = process.env.ALSM_UC66_TEST === 'owned-local-only' ? describe : describe.skip;
suite('UC66-05B independent-process failures and restart recovery (owned real Mongo/HTTP)', () => {
  jest.setTimeout(120000);
  let owned: Awaited<ReturnType<typeof createOwnedUc66Environment>>;
  const secret = `readiness-${randomUUID()}`;
  const children: ChildProcess[] = [];
  const endpoints: string[] = [];
  let token: string;
  const org = `/support/organizations/${ids.organization}`;
  const snapshot = (id: string) =>
    owned.connection.collection('support_contexts').findOne({ _id: id as never });
  const readAudits = (id: string) =>
    owned.connection
      .collection('audit_logs')
      .find({ action: 'SUPPORT_WORKSPACE_READ', 'metadata.contextId': id })
      .toArray();
  const project = (id: string) => `${org}/contexts/${id}/workspace/projects/${ids.project}`;
  async function command(index: number, type: string, expected = 'armed') {
    const response = waitFor(children[index], expected);
    children[index].send({ type });
    return response;
  }
  async function start(index: number) {
    const child = spawn(
      process.execPath,
      ['-r', 'ts-node/register', join(__dirname, 'uc66-integration/child-server.ts')],
      { stdio: ['ignore', 'ignore', 'inherit', 'ipc'], windowsHide: true },
    );
    children[index] = child;
    const ready = waitFor(child, 'ready');
    child.send({ type: 'start', uri: owned.uri, secret });
    const reply = await ready;
    expect(reply.pid).not.toBe(process.pid);
    endpoints[index] = `http://127.0.0.1:${reply.port}/api/v1`;
  }
  async function stop(index: number) {
    const child = children[index];
    if (!child?.connected) return;
    try {
      await command(index, 'stop', 'stopped');
    } finally {
      if (child.exitCode === null) child.kill();
    }
  }
  async function call(index: number, path: string, method = 'GET') {
    const response = await fetch(endpoints[index] + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(method === 'POST' ? { body: '{}' } : {}),
    });
    return { status: response.status, body: await response.json() };
  }
  async function enter() {
    const response = await call(0, `${org}/contexts`, 'POST');
    expect(response.status).toBe(201);
    await command(0, 'reset-metrics', 'metrics');
    return response.body.id as string;
  }
  async function singleCallback() {
    expect((await command(0, 'metrics', 'metrics')).businessCallbacks).toBe(1);
  }
  beforeAll(async () => {
    owned = await createOwnedUc66Environment();
    const bootstrap = await createUc66TestApp(owned.uri, secret, { now: () => new Date() });
    await bootstrap.app.close();
    await Promise.all([start(0), start(1)]);
    expect(children[0].pid).not.toBe(children[1].pid);
  });
  beforeEach(async () => {
    await owned.verify();
    for (const collection of await owned.connection.db!.listCollections().toArray())
      if (collection.name !== '_uc66_05a_owner')
        await owned.connection.collection(collection.name).deleteMany({});
    // Seed through registered real models; data cleanup never drops collections/indexes.
    const bootstrap = await createUc66TestApp(owned.uri, secret, { now: () => new Date() });
    try {
      await seedUc66(bootstrap.connection);
    } finally {
      await bootstrap.app.close();
    }
    const response = await fetch(`${endpoints[0]}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(uc66Credentials),
    });
    expect(response.status).toBe(200);
    token = ((await response.json()) as { accessToken: string }).accessToken;
  });
  afterAll(async () => {
    await Promise.all([stop(0), stop(1)]);
    await owned?.dispose();
  });

  it('provisions the declared context index idempotently without deleting records or other indexes', async () => {
    const id = await enter();
    const contexts = owned.connection.collection('support_contexts');
    const model = owned.connection.model('OwnedReadinessContext', SupportContextSchema);
    await model.init();
    await contexts.createIndex({ revision: 1 }, { name: 'owned_readiness_probe' });
    const indexes = await contexts.listIndexes().toArray();
    const before = await snapshot(id);
    const auditCount = await owned.connection.collection('audit_logs').countDocuments();
    for (let attempt = 0; attempt < 2; attempt++) await model.createIndexes();
    expect(await contexts.listIndexes().toArray()).toEqual(indexes);
    expect(indexes.some((index) => index.expireAfterSeconds !== undefined)).toBe(false);
    expect(await snapshot(id)).toEqual(before);
    expect(await owned.connection.collection('audit_logs').countDocuments()).toBe(auditCount);
    expect(await contexts.countDocuments()).toBe(1);
  });

  it.each(['role', 'session', 'account', 'organization', 'ownership'])(
    'observes persisted %s loss while another process has a projection pending',
    async (kind) => {
      const id = await enter(),
        before = (await snapshot(id))!;
      await command(0, 'pause-projection');
      const projected = waitFor(children[0], 'projected');
      const pending = call(0, project(id));
      await projected;
      try {
        if (kind === 'role')
          await owned.connection.collection('user_roles').deleteMany({ userId: ids.actor });
        if (kind === 'session')
          await owned.connection
            .collection('user_sessions')
            .updateMany(
              { userId: new Types.ObjectId(ids.actor) },
              { $set: { revokedAt: new Date() } },
            );
        if (kind === 'account')
          await owned.connection
            .collection('users')
            .updateOne({ _id: new Types.ObjectId(ids.actor) }, { $set: { isActive: false } });
        if (kind === 'organization')
          await owned.connection
            .collection('organizations')
            .updateOne(
              { _id: new Types.ObjectId(ids.organization) },
              { $set: { status: 'SUSPENDED' } },
            );
        if (kind === 'ownership')
          await owned.connection
            .collection('projects')
            .updateOne(
              { _id: new Types.ObjectId(ids.project) },
              { $set: { organizationId: new Types.ObjectId(ids.otherOrganization) } },
            );
      } finally {
        children[0].send({ type: 'release' });
      }
      const result = await pending;
      expect([401, 403, 404]).toContain(result.status);
      expect(result.body).not.toHaveProperty('item');
      expect(await snapshot(id)).toEqual(before);
      expect(await readAudits(id)).toHaveLength(0);
      await singleCallback();
      for (const index of [0, 1])
        expect([401, 403, 404]).toContain((await call(index, project(id))).status);
    },
  );

  it('aborts a real Mongo stale writer after Exit on the other process, without replay/audit', async () => {
    const id = await enter();
    await command(0, 'pause-projection');
    const projected = waitFor(children[0], 'projected');
    const pending = call(0, project(id));
    await projected;
    try {
      expect((await call(1, `${org}/contexts/${id}/exit`, 'POST')).status).toBe(200);
    } finally {
      children[0].send({ type: 'release' });
    }
    expect((await pending).status).toBe(409);
    await singleCallback();
    expect(await readAudits(id)).toHaveLength(0);
    expect(await snapshot(id)).toMatchObject({ state: 'EXITED', revision: 2 });
    for (const index of [0, 1]) expect((await call(index, project(id))).status).toBe(409);
  });

  it('rolls a pending real-clock renewal and audit back across the original idle deadline', async () => {
    const id = await enter();
    const aged = Date.now() - (15 * 60000 - 3000);
    await owned.connection.collection('support_contexts').updateOne(
      { _id: id as never },
      {
        $set: {
          createdAt: new Date(aged),
          lastActivityAt: new Date(aged),
          expiresAt: new Date(aged + 30 * 60000),
        },
      },
    );
    const before = (await snapshot(id))!;
    await command(0, 'pause-audit');
    const audited = waitFor(children[0], 'audited');
    const pending = call(0, project(id));
    await audited;
    try {
      await new Promise((resolve) => setTimeout(resolve, 5000));
    } finally {
      children[0].send({ type: 'release' });
    }
    expect((await pending).status).toBe(409);
    await singleCallback();
    expect(await snapshot(id)).toEqual(before);
    expect(await readAudits(id)).toHaveLength(0);
    for (const index of [0, 1]) {
      const recovery = await call(index, `${org}/recovery?contextId=${id}`);
      expect(recovery.body.usable).toBe(false);
      expect((await call(index, project(id))).status).toBe(409);
    }
  });

  it('rolls back both real writes after an audit acknowledgement failure without replay', async () => {
    const id = await enter(),
      before = (await snapshot(id))!;
    await command(0, 'fail-audit');
    const result = await call(0, project(id));
    expect(result.status).toBe(503);
    expect(result.body.code).toBe('SUPPORT_CONTEXT_PERSISTENCE_UNAVAILABLE');
    expect(result.body).not.toHaveProperty('item');
    await singleCallback();
    expect(await snapshot(id)).toEqual(before);
    expect(await readAudits(id)).toHaveLength(0);
  });

  it('withholds committed data after Exit on the other process, retaining exactly one audit', async () => {
    const id = await enter();
    await command(0, 'pause-after-commit');
    const committed = waitFor(children[0], 'committed');
    const pending = call(0, project(id));
    await committed;
    try {
      expect((await call(1, `${org}/contexts/${id}/exit`, 'POST')).status).toBe(200);
    } finally {
      children[0].send({ type: 'release' });
    }
    const result = await pending;
    expect([403, 503]).toContain(result.status);
    expect(result.body.code).toBe('SUPPORT_WORKSPACE_DELIVERY_WITHHELD');
    expect(result.body.details[0]).toMatchObject({
      contextId: id,
      activityCommitted: true,
      retrySafe: false,
    });
    expect(result.body).not.toHaveProperty('item');
    await singleCallback();
    const audits = await readAudits(id);
    expect(audits).toHaveLength(1);
    expect(audits[0].metadata.operationId).toBe(result.body.details[0].operationId);
    expect(await snapshot(id)).toMatchObject({ state: 'EXITED', revision: 3 });
    for (const index of [0, 1]) expect((await call(index, project(id))).status).toBe(409);
  });

  it('recovers a lost commit ACK after an actual process restart using original identities and no replay', async () => {
    const id = await enter();
    await command(0, 'lose-commit-ack');
    const result = await call(0, project(id));
    expect(result.status).toBe(503);
    expect(result.body.code).toBe('SUPPORT_CONTEXT_OUTCOME_UNCONFIRMED');
    const reference = result.body.details[0];
    expect(reference).toMatchObject({
      contextId: id,
      mutationCommitted: 'unknown',
      retrySafe: false,
    });
    await singleCallback();
    const before = (await snapshot(id))!;
    const audits = await readAudits(id);
    expect(audits).toHaveLength(1);
    expect(audits[0].metadata.operationId).toBe(reference.operationId);
    const oldPid = children[0].pid;
    await stop(0);
    await start(0);
    expect(children[0].pid).not.toBe(oldPid);
    for (const index of [0, 1]) {
      const recovery = await call(
        index,
        `${org}/recovery?contextId=${id}&operationId=${reference.operationId}`,
      );
      expect(recovery.status).toBe(200);
      expect(recovery.body.operation).toEqual({
        id: reference.operationId,
        state: 'COMMITTED',
        kind: 'WORKSPACE_PROJECT_DETAIL',
      });
      expect(recovery.body.context.id).toBe(id);
      expect(recovery.body.usable).toBe(true);
    }
    expect(await snapshot(id)).toEqual(before);
    expect(await readAudits(id)).toHaveLength(1);
    expect((await command(0, 'metrics', 'metrics')).businessCallbacks).toBe(0);
  });
});
