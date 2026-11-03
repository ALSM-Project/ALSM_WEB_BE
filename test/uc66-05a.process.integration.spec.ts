import { ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createOwnedUc66Environment } from './uc66-integration/owned-environment';
import { createUc66TestApp } from './uc66-integration/test-app';
import { seedUc66, uc66Credentials, uc66Ids as ids } from './uc66-integration/seed';

interface Reply {
  type: string;
  port: number;
  pid: number;
  message?: string;
}
function waitFor(child: ChildProcess, type: string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Owned child timed out: ${type}`));
    }, 30000);
    const onMessage = (message: Reply) => {
      if (message.type === 'error') {
        cleanup();
        reject(new Error(message.message));
      } else if (message.type === type) {
        cleanup();
        resolve(message);
      }
    };
    const onExit = () => {
      cleanup();
      reject(new Error(`Owned child exited before ${type}`));
    };
    function cleanup() {
      clearTimeout(timer);
      child.off('message', onMessage);
      child.off('exit', onExit);
    }
    child.on('message', onMessage);
    child.on('exit', onExit);
  });
}
const suite = process.env.ALSM_UC66_TEST === 'owned-local-only' ? describe : describe.skip;
suite('UC66-05A actual separate Node processes: persisted revocation and context CAS', () => {
  jest.setTimeout(90000);
  let owned: Awaited<ReturnType<typeof createOwnedUc66Environment>>;
  const children: ChildProcess[] = [];
  const endpoints: string[] = [];
  beforeAll(async () => {
    owned = await createOwnedUc66Environment();
    const bootstrap = await createUc66TestApp(owned.uri, `bootstrap-${randomUUID()}`, {
      now: () => new Date(),
    });
    try {
      await seedUc66(bootstrap.connection);
    } finally {
      await bootstrap.app.close();
    }
    const secret = `two-process-${randomUUID()}`;
    await Promise.all(
      [0, 1].map(async (index) => {
        const child = spawn(
          process.execPath,
          ['-r', 'ts-node/register', join(__dirname, 'uc66-integration/child-server.ts')],
          { stdio: ['ignore', 'ignore', 'inherit', 'ipc'], windowsHide: true },
        );
        children[index] = child;
        const ready = waitFor(child, 'ready');
        child.send({ type: 'start', uri: owned.uri, secret });
        const result = await ready;
        expect(result.pid).not.toBe(process.pid);
        endpoints[index] = `http://127.0.0.1:${result.port}/api/v1`;
      }),
    );
    expect(children[0].pid).not.toBe(children[1].pid);
  });
  afterAll(async () => {
    await Promise.all(
      children.map(async (child) => {
        if (!child.connected) return;
        try {
          const stopped = waitFor(child, 'stopped');
          child.send({ type: 'stop' });
          await stopped;
        } finally {
          if (child.exitCode === null) child.kill();
        }
      }),
    );
    await owned?.dispose();
  });
  it('denies role loss on both processes and aborts a stale read after Exit commits on the other process', async () => {
    const login = await fetch(`${endpoints[0]}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(uc66Credentials),
    });
    expect(login.status).toBe(200);
    const tokens = (await login.json()) as { accessToken: string };
    const headers = {
      Authorization: `Bearer ${tokens.accessToken}`,
      'Content-Type': 'application/json',
    };
    const call = (index: number, path: string, method = 'GET') =>
      fetch(endpoints[index] + path, {
        method,
        headers,
        ...(method === 'POST' ? { body: '{}' } : {}),
      });
    const org = `/support/organizations/${ids.organization}`;
    const initial = await call(0, `${org}/contexts`, 'POST');
    expect(initial.status).toBe(201);
    const initialId = ((await initial.json()) as { id: string }).id;
    expect((await call(1, `${org}/contexts/${initialId}/workspace/projects`)).status).toBe(200);
    const revoked = waitFor(children[1], 'revoked');
    children[1].send({ type: 'revoke-role' });
    await revoked;
    for (const index of [0, 1])
      expect((await call(index, `${org}/contexts/${initialId}/workspace/projects`)).status).toBe(
        403,
      );
    // Fresh explicit Enter after a new persisted assignment; never revive the old binding.
    await owned.connection.collection('user_roles').insertOne({
      userId: ids.actor,
      roleId: 'INTERNAL_SUPPORT',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const next = await call(1, `${org}/contexts`, 'POST');
    expect(next.status).toBe(201);
    const contextId = ((await next.json()) as { id: string }).id;
    const armed = waitFor(children[0], 'armed');
    children[0].send({ type: 'pause-projection' });
    await armed;
    const projected = waitFor(children[0], 'projected');
    const reading = call(0, `${org}/contexts/${contextId}/workspace/projects/${ids.project}`);
    await projected;
    try {
      expect((await call(1, `${org}/contexts/${contextId}/exit`, 'POST')).status).toBe(200);
    } finally {
      children[0].send({ type: 'release' });
    }
    expect((await reading).status).toBe(409);
    expect(
      await owned.connection
        .collection('audit_logs')
        .countDocuments({ action: 'SUPPORT_WORKSPACE_READ', 'metadata.contextId': contextId }),
    ).toBe(0);
    const stored = await owned.connection
      .collection('support_contexts')
      .findOne({ _id: contextId as never });
    expect(stored).toMatchObject({ state: 'EXITED', revision: 2 });
    for (const index of [0, 1])
      expect((await call(index, `${org}/contexts/${contextId}/workspace/projects`)).status).toBe(
        409,
      );
  });
});
