// Opt-in compiled-API regression. Every identity, payment and output is a disposable fixture.
// Build first; use only the exact owned loopback services guarded below.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const { randomBytes, randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
require('reflect-metadata');
const { JwtService } = require('@nestjs/jwt');
const { RequestMethod } = require('@nestjs/common');
const {
  MODULE_METADATA,
  PATH_METADATA,
  METHOD_METADATA,
  GUARDS_METADATA,
} = require('@nestjs/common/constants');
const { declaredIndexes } = require('./team-dev-indexes.cjs');

const raceMode = process.env.ALSM_AUTH_RACE_HTTP_TEST === 'owned-local-only';
const mongo = raceMode ? 'alsm-auth-race-20261017-mongo' : 'alsm-auth-revocation-20261017-mongo';
const mongoPort = raceMode ? '27147' : '27137';
const replicaSet = raceMode ? 'alsmAuthRace' : 'alsmAuthRevocation';
function verifyServices(running = true) {
  for (const [name, owner, inside, outside, expectedRunning] of [
    [
      mongo,
      raceMode ? 'auth-race-20261017' : 'auth-revocation-20261017',
      '27017/tcp',
      mongoPort,
      running,
    ],
    ['alsm-emergency-20261017-browser-redis', 'emergency-20261017', '6379/tcp', '6398', true],
  ]) {
    const [info] = JSON.parse(
      execFileSync('docker', ['inspect', name], { encoding: 'utf8', windowsHide: true }),
    );
    assert.equal(info.Config.Labels['alsm.owner'], owner);
    assert.equal(info.State.Running, expectedRunning);
    assert.deepEqual(info.NetworkSettings.Ports[inside] || info.HostConfig.PortBindings[inside], [
      { HostIp: '127.0.0.1', HostPort: outside },
    ]);
  }
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(work) {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      return await work();
    } catch (error) {
      if (attempt === 59) throw error;
      await delay(200);
    }
  }
}

test(
  'compiled protected APIs enforce persisted user-session lifecycle',
  {
    skip: process.env.ALSM_AUTH_REVOCATION_HTTP_TEST !== 'owned-local-only',
    timeout: 600000,
  },
  async (t) => {
    verifyServices();
    // Never send the fixture workflow to an unrelated process already on this port.
    await new Promise((resolve, reject) => {
      const probe = require('node:net').createServer();
      probe.once('error', reject);
      probe.listen(3119, '127.0.0.1', () => probe.close(resolve));
    });
    const runId = randomUUID().replaceAll('-', '');
    const database = `alsm_auth_revocation_${runId}`;
    assert.match(database, /^alsm_auth_revocation_[a-f0-9]{32}$/);
    const evidence = path.resolve(
      __dirname,
      '../coverage/auth-revocation',
      ...(raceMode ? ['race-fix'] : []),
    );
    fs.mkdirSync(evidence, { recursive: true });
    const uri = `mongodb://127.0.0.1:${mongoPort}/${database}?replicaSet=${replicaSet}&directConnection=true`;
    const connection = await mongoose
      .createConnection(uri, { serverSelectionTimeoutMS: 5000, autoIndex: false })
      .asPromise();
    let child,
      secondChild,
      ownsDatabase = false,
      mongoStopped = false;
    const proofs = [];
    const password = randomBytes(24).toString('base64url');
    const secret = randomBytes(48).toString('hex');
    const oid = () => new mongoose.Types.ObjectId();
    const user = oid(),
      foreign = oid(),
      organization = oid(),
      foreignOrganization = oid();
    const jwt = new JwtService();
    const env = {
      ...process.env,
      NODE_ENV: 'test',
      PORT: '3119',
      MONGODB_URI: uri + '&appName=alsm-auth-race-app&serverSelectionTimeoutMS=2000',
      REDIS_HOST: '127.0.0.1',
      REDIS_PORT: '6398',
      REDIS_PASSWORD: '',
      JWT_ACCESS_SECRET: secret,
      JWT_REFRESH_SECRET: randomBytes(48).toString('hex'),
      JWT_ACCESS_EXPIRES_IN: '15m',
      JWT_REFRESH_EXPIRES_IN: '1h',
      MFA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      CORS_ORIGINS: 'http://127.0.0.1:3011,http://127.0.0.1:3012',
      STORAGE_ROOT: path.join(evidence, 'storage', runId),
      SMTP_HOST: '',
      SMTP_USER: '',
      SMTP_PASS: '',
      CASSO_API_KEY: '',
      GOOGLE_CLIENT_ID: '',
      GOOGLE_SERVICE_ACCOUNT_JSON: '',
      GOOGLE_CALENDAR_USER_EMAIL: '',
      AI_VALIDATION_ENABLED: 'false',
      AI_EVAL_ALLOW_LIVE_PROVIDER: 'false',
      AI_PROVIDER: 'fake',
      OPENAI_API_KEY: '',
      GEMINI_API_KEY: '',
      CONVERSION_WORKER_ENABLED: 'false',
      VALIDATION_WORKER_ENABLED: 'false',
    };
    async function request(method, route, token, body, tenant = String(organization), port = 3119) {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1` + route, {
        method,
        signal: AbortSignal.timeout(45000),
        headers: {
          'Content-Type': 'application/json',
          'x-organization-id': tenant,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const raw = await response.text();
      return { status: response.status, body: raw ? JSON.parse(raw) : {} };
    }
    async function expectStatus(method, route, token, status, body, tenant) {
      const result = await request(method, route, token, body, tenant);
      proofs.push({
        method,
        route,
        expected: status,
        actual: result.status,
        code: result.body.code,
      });
      assert.equal(result.status, status, `${method} ${route}`);
      return result.body;
    }
    async function login(email = 'auth-revocation-fixture@example.invalid') {
      return expectStatus('POST', '/auth/login', undefined, 200, { email, password });
    }
    function claims(tokens) {
      return jwt.verify(tokens.accessToken, { secret });
    }
    try {
      assert.equal((await connection.db.listCollections().toArray()).length, 0);
      assert.equal((await connection.db.admin().command({ hello: 1 })).setName, replicaSet);
      await connection.collection('_auth_revocation_owner').insertOne({ runId, database });
      ownsDatabase = true;
      for (const [collection, indexes] of declaredIndexes()) {
        await connection.db.createCollection(collection);
        if (indexes.size)
          await connection.collection(collection).createIndexes([...indexes.values()]);
      }
      const log = fs.openSync(path.join(evidence, 'compiled-api-startup.txt'), 'w');
      child = spawn(process.execPath, ['dist/main'], {
        cwd: path.resolve(__dirname, '..'),
        env,
        windowsHide: true,
        stdio: ['ignore', log, log],
      });
      fs.closeSync(log);
      await until(async () => {
        assert.equal((await request('GET', '/health')).status, 200);
      });
      if (raceMode) {
        await new Promise((resolve, reject) => {
          const probe = require('node:net').createServer();
          probe.once('error', reject);
          probe.listen(3120, '127.0.0.1', () => probe.close(resolve));
        });
        const secondLog = fs.openSync(path.join(evidence, 'second-api-startup.txt'), 'w');
        secondChild = spawn(process.execPath, ['dist/main'], {
          cwd: path.resolve(__dirname, '..'),
          env: { ...env, PORT: '3120' },
          windowsHide: true,
          stdio: ['ignore', secondLog, secondLog],
        });
        fs.closeSync(secondLog);
        await until(async () =>
          assert.equal(
            (await request('GET', '/health', undefined, undefined, undefined, 3120)).status,
            200,
          ),
        );
      }
      const hash = await bcrypt.hash(password, 10);
      await connection.collection('users').insertMany([
        {
          _id: user,
          email: 'auth-revocation-fixture@example.invalid',
          fullName: 'TEST FIXTURE Session Owner',
          passwordHash: hash,
          isActive: true,
          isEmailVerified: true,
          isPlatformAdmin: true,
          mustChangePassword: false,
        },
        {
          _id: foreign,
          email: 'auth-revocation-foreign@example.invalid',
          fullName: 'TEST FIXTURE Foreign Owner',
          passwordHash: hash,
          isActive: true,
          isEmailVerified: true,
          isPlatformAdmin: false,
          mustChangePassword: false,
        },
      ]);
      await connection.collection('organizations').insertMany([
        {
          _id: organization,
          name: 'TEST FIXTURE Session Organization',
          type: 'INTERNAL',
          members: [{ userId: user, role: 'OWNER' }],
        },
        {
          _id: foreignOrganization,
          name: 'TEST FIXTURE Foreign Organization',
          type: 'INTERNAL',
          members: [{ userId: foreign, role: 'OWNER' }],
        },
      ]);
      await connection
        .collection('user_roles')
        .insertOne({ userId: String(user), roleId: 'SYSTEM_ADMIN' });
      let active = await login();
      const project = await expectStatus('POST', '/projects', active.accessToken, 201, {
        name: 'TEST FIXTURE Auth Project',
        conversionType: 'COBOL_TO_JAVA',
      });
      const team = await expectStatus('POST', '/teams', active.accessToken, 201, {
        creationId: String(oid()),
        name: 'TEST FIXTURE Auth Sales',
        kind: 'SALES',
        memberIds: [String(user)],
        managerIds: [String(user)],
        projectAssignments: [],
        expectedRevision: 0,
      });
      const {
        LocalDiskStorageAdapter,
      } = require('../dist/shared/storage/local-disk-storage.adapter');
      const storage = new LocalDiskStorageAdapter({ get: () => env.STORAGE_ROOT });
      const reference = await storage.writeFiles('TEST-FIXTURE-NO-CONVERTER', [
        {
          relativePath: 'TEST_FIXTURE.java',
          content: Buffer.from(
            '// Synthetic test fixture, no converter executed.\nclass Fixture {}',
          ),
        },
      ]);
      const job = oid();
      await connection.collection('conversion_jobs').insertOne({
        _id: job,
        organizationId: organization,
        projectId: new mongoose.Types.ObjectId(project.id),
        createdBy: user,
        status: 'COMPLETED',
        conversionType: 'COBOL_TO_JAVA',
        priority: 'NORMAL',
        attemptCount: 1,
        maxAttempts: 3,
        executionGeneration: 0,
        resultReference: reference,
        toolVersion: 'SYNTHETIC-TEST-FIXTURE',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const queue = `/projects/${project.id}/conversions`;
      const review = `${queue}/${job}/quality-review`;
      const performance = `/teams/${team.id}/performance?days=7`;

      await t.test(
        'active persisted session works across root, RBAC and menu controllers',
        async () => {
          for (const route of [
            '/auth/me',
            '/auth/sessions',
            '/projects',
            queue,
            `/conversions/${job}`,
            `/conversions/${job}/result`,
            review,
            performance,
            '/billing/subscription',
            '/users',
            '/navigation',
          ])
            await expectStatus('GET', route, active.accessToken, 200);
          // SYSTEM_ADMIN is seeded with roles.manage, not roles.view. Preserve RBAC denial.
          await expectStatus('GET', '/roles', active.accessToken, 403);
        },
      );
      await t.test(
        'logout revokes exactly the logged-in session and rejects its still-unexpired JWT',
        async () => {
          const old = active;
          await expectStatus('POST', '/auth/logout', undefined, 204, {
            refreshToken: old.refreshToken,
          });
          assert.ok(
            (
              await connection
                .collection('user_sessions')
                .findOne({ _id: new mongoose.Types.ObjectId(claims(old).sid) })
            ).revokedAt,
          );
          assert.ok(claims(old).exp * 1000 > Date.now());
          for (const route of [
            '/auth/me',
            queue,
            `/conversions/${job}`,
            `/conversions/${job}/result`,
            review,
            performance,
          ])
            await expectStatus('GET', route, old.accessToken, 401);
          await expectStatus('POST', `/conversions/${job}/retry`, old.accessToken, 401);
          await expectStatus('PATCH', review, old.accessToken, 401, { status: 'ACCEPTED' });
          await expectStatus('POST', '/auth/refresh', undefined, 401, {
            refreshToken: old.refreshToken,
          });

          // Enumerate the actual compiled controller metadata, including imported modules.
          const previous = { ...process.env };
          Object.assign(process.env, env);
          let AppModule;
          try {
            ({ AppModule } = require('../dist/app.module'));
          } finally {
            process.env = previous;
          }
          const { JwtAuthGuard } = require('../dist/shared/security/jwt-auth.guard');
          const inventory = [],
            visited = new Set();
          function walk(module) {
            module = module.module || module;
            if (visited.has(module)) return;
            visited.add(module);
            for (const controller of Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, module) ||
              []) {
              const prefix = Reflect.getMetadata(PATH_METADATA, controller) || '';
              for (const name of Object.getOwnPropertyNames(controller.prototype)) {
                const handler = controller.prototype[name];
                if (typeof handler !== 'function') continue;
                const method = Reflect.getMetadata(METHOD_METADATA, handler);
                if (method === undefined) continue;
                const guards = [
                  ...(Reflect.getMetadata(GUARDS_METADATA, controller) || []),
                  ...(Reflect.getMetadata(GUARDS_METADATA, handler) || []),
                ];
                if (!guards.includes(JwtAuthGuard)) continue;
                const route =
                  '/' +
                  [prefix, Reflect.getMetadata(PATH_METADATA, handler) || '']
                    .join('/')
                    .split('/')
                    .filter(Boolean)
                    .join('/');
                inventory.push({
                  method: RequestMethod[method],
                  route,
                  controller: controller.name,
                  handler: name,
                });
              }
            }
            for (const imported of Reflect.getMetadata(MODULE_METADATA.IMPORTS, module) || [])
              walk(imported);
          }
          walk(AppModule);
          assert.ok(inventory.length > 90);
          assert.ok(inventory.some((r) => r.controller === 'RbacController'));
          assert.ok(inventory.some((r) => r.controller === 'NavigationController'));
          for (const entry of inventory) {
            const route = entry.route.replace(/:[^/]+/g, String(job));
            await expectStatus(
              entry.method,
              route,
              old.accessToken,
              401,
              ['GET', 'HEAD', 'DELETE'].includes(entry.method) ? undefined : {},
            );
          }
          fs.writeFileSync(
            path.join(evidence, 'guarded-route-inventory.json'),
            JSON.stringify(inventory, null, 2),
          );
          active = await login();
        },
      );
      await t.test('missing sid, malformed sid and cross-user sid are rejected', async () => {
        const other = await login('auth-revocation-foreign@example.invalid');
        for (const sid of [undefined, 'invalid', claims(other).sid]) {
          const token = jwt.sign(
            { sub: String(user), ...(sid === undefined ? {} : { sid }) },
            { secret, expiresIn: '5m' },
          );
          await expectStatus('GET', '/auth/me', token, 401);
        }
      });
      await t.test('expired persisted session is rejected despite a valid access JWT', async () => {
        const old = await login();
        await connection
          .collection('user_sessions')
          .updateOne(
            { _id: new mongoose.Types.ObjectId(claims(old).sid) },
            { $set: { expiresAt: new Date(Date.now() - 1000) } },
          );
        await expectStatus('GET', '/auth/me', old.accessToken, 401);
      });
      await t.test(
        'deactivated account and required password change reject active sessions',
        async () => {
          for (const change of [{ isActive: false }, { mustChangePassword: true }]) {
            await connection.collection('users').updateOne({ _id: user }, { $set: change });
            await expectStatus('GET', '/auth/me', active.accessToken, 401);
            await connection
              .collection('users')
              .updateOne({ _id: user }, { $set: { isActive: true, mustChangePassword: false } });
          }
          await expectStatus('GET', '/auth/me', active.accessToken, 200);
        },
      );
      await t.test('missing, invalidly signed and expired JWTs reject access', async () => {
        for (const token of [
          undefined,
          'invalid',
          jwt.sign(
            { sub: String(user), sid: claims(active).sid },
            { secret: 'deliberately-wrong-fixture-key' },
          ),
          jwt.sign({ sub: String(user), sid: claims(active).sid }, { secret, expiresIn: -1 }),
        ])
          await expectStatus('GET', '/auth/me', token, 401);
      });
      await t.test(
        'refresh rotation accepts only the replacement session and rejects old refresh reuse',
        async () => {
          const old = active;
          active = await expectStatus('POST', '/auth/refresh', undefined, 200, {
            refreshToken: old.refreshToken,
          });
          assert.equal(claims(active).sid, claims(old).sid);
          assert.notEqual(claims(active).sv, claims(old).sv);
          await expectStatus('GET', '/auth/me', old.accessToken, 401);
          await expectStatus('GET', queue, old.accessToken, 401);
          await expectStatus('POST', '/auth/refresh', undefined, 401, {
            refreshToken: old.refreshToken,
          });
          await expectStatus('GET', '/auth/me', active.accessToken, 200);
        },
      );
      await t.test('revoking another session preserves the current session', async () => {
        const other = await login();
        await expectStatus(
          'DELETE',
          `/auth/sessions/${claims(other).sid}`,
          active.accessToken,
          204,
        );
        await expectStatus('GET', '/auth/me', other.accessToken, 401);
        await expectStatus('GET', '/auth/me', active.accessToken, 200);
      });
      await t.test('tenant isolation remains enforced for an active foreign account', async () => {
        const other = await login('auth-revocation-foreign@example.invalid');
        await expectStatus('GET', '/auth/me', other.accessToken, 200);
        await expectStatus('GET', queue, other.accessToken, 403);
      });
      await t.test(
        'public login, registration, verification, refresh and health remain public',
        async () => {
          await expectStatus('GET', '/health', undefined, 200);
          await expectStatus('POST', '/auth/register', undefined, 400, {});
          await expectStatus('POST', '/auth/verify-email', undefined, 400, {});
          await expectStatus('POST', '/auth/login', undefined, 401, {
            email: 'nobody@example.invalid',
            password,
          });
          await expectStatus('POST', '/auth/refresh', undefined, 401, { refreshToken: 'invalid' });
        },
      );
      await t.test(
        'forced-password login admits only credential remediation and then recovers',
        async () => {
          await connection
            .collection('users')
            .updateOne({ _id: user }, { $set: { mustChangePassword: true } });
          const forced = await login();
          assert.equal(forced.mustChangePassword, true);
          for (const route of ['/auth/me', '/auth/sessions', '/projects', '/navigation', queue])
            await expectStatus('GET', route, forced.accessToken, 401);
          await expectStatus('POST', '/auth/change-password', forced.accessToken, 401, {
            currentPassword: 'wrong-password-fixture',
            newPassword: password + 'new',
          });
          await expectStatus('POST', '/auth/change-password', forced.accessToken, 200, {
            currentPassword: password,
            newPassword: password + 'new',
          });
          await expectStatus('GET', '/auth/me', forced.accessToken, 200);
          assert.equal(
            (await connection.collection('users').findOne({ _id: user })).mustChangePassword,
            false,
          );
          await connection.collection('users').updateOne(
            { _id: user },
            {
              $unset: { passwordHash: '' },
              $set: { mustChangePassword: true },
            },
          );
          await expectStatus('GET', '/auth/me', forced.accessToken, 401);
          await expectStatus('POST', '/auth/set-password', forced.accessToken, 200, {
            newPassword: password,
          });
          await expectStatus('GET', '/auth/me', forced.accessToken, 200);
          await expectStatus('POST', '/auth/logout', undefined, 204, {
            refreshToken: forced.refreshToken,
          });
          await expectStatus('POST', '/auth/change-password', forced.accessToken, 401, {
            currentPassword: password,
            newPassword: password + 'new',
          });
        },
      );
      if (raceMode) {
        const collection = connection.collection('user_sessions');
        const raceEvidence = { rotations: [], logout: [], failures: [] };
        const root = (tokens) => ({ _id: new mongoose.Types.ObjectId(claims(tokens).sid) });
        const activeCount = (tokens) =>
          collection.countDocuments({
            ...root(tokens),
            revokedAt: { $exists: false },
            expiresAt: { $gt: new Date() },
          });
        const refresh = (tokens, port = 3119) =>
          request(
            'POST',
            '/auth/refresh',
            undefined,
            { refreshToken: tokens.refreshToken },
            undefined,
            port,
          );
        const logout = (tokens, port = 3119) =>
          request(
            'POST',
            '/auth/logout',
            undefined,
            { refreshToken: tokens.refreshToken },
            undefined,
            port,
          );
        await t.test(
          '2, 5 and 10 refreshes have exactly one winner across two compiled processes',
          async () => {
            for (let repeat = 0; repeat < 3; repeat++)
              for (const concurrency of [2, 5, 10]) {
                const original = await login();
                const results = await Promise.all(
                  Array.from({ length: concurrency }, async (_, i) => {
                    if (repeat) await delay((i % 3) * repeat * 7);
                    return refresh(original, i % 2 ? 3120 : 3119);
                  }),
                );
                assert.equal(results.filter((r) => r.status === 200).length, 1);
                assert.equal(results.filter((r) => r.status === 401).length, concurrency - 1);
                const winner = results.find((r) => r.status === 200).body;
                assert.equal(await activeCount(original), 1);
                assert.equal(await collection.countDocuments(root(original)), 1);
                assert.equal(claims(original).sid, claims(winner).sid);
                assert.notEqual(claims(original).sv, claims(winner).sv);
                await expectStatus('GET', '/auth/me', original.accessToken, 401);
                await expectStatus('GET', '/auth/me', winner.accessToken, 200);
                assert.equal((await refresh(original)).status, 401);
                assert.equal((await logout(original, 3120)).status, 204); // Stale proof terminates the winner.
                assert.equal(await activeCount(winner), 0);
                await expectStatus('GET', '/auth/me', winner.accessToken, 401);
                assert.equal((await refresh(winner)).status, 401);
                raceEvidence.rotations.push({
                  repeat,
                  concurrency,
                  successes: 1,
                  rejections: concurrency - 1,
                  activeReplacementsBeforeLogout: 1,
                  afterLogout: 0,
                  processes: 2,
                });
              }
          },
        );
        await t.test(
          'logout-first, refresh-first and simultaneous interleavings terminate only their browser lineage',
          async () => {
            for (const order of ['logout-first', 'refresh-first', 'simultaneous'])
              for (let repeat = 0; repeat < 4; repeat++) {
                const deviceA = await login(),
                  deviceB = await login();
                let rotated, ended;
                if (order === 'logout-first') {
                  ended = await logout(deviceA);
                  rotated = await refresh(deviceA, 3120);
                } else if (order === 'refresh-first') {
                  rotated = await refresh(deviceA, 3120);
                  ended = await logout(deviceA);
                } else
                  [rotated, ended] = await Promise.all([refresh(deviceA, 3120), logout(deviceA)]);
                assert.equal(ended.status, 204);
                assert.ok([200, 401].includes(rotated.status));
                assert.equal(await activeCount(deviceA), 0);
                assert.equal(await collection.countDocuments(root(deviceA)), 1);
                await expectStatus('GET', '/auth/me', deviceA.accessToken, 401);
                assert.equal((await refresh(deviceA)).status, 401);
                if (rotated.status === 200) {
                  await expectStatus('GET', '/auth/me', rotated.body.accessToken, 401);
                  assert.equal((await refresh(rotated.body)).status, 401);
                }
                await expectStatus('GET', '/auth/me', deviceB.accessToken, 200);
                const b = await refresh(deviceB);
                assert.equal(b.status, 200);
                assert.equal((await logout(b.body)).status, 204);
                raceEvidence.logout.push({
                  order,
                  repeat,
                  refreshStatus: rotated.status,
                  logoutStatus: ended.status,
                  survivingLineage: 0,
                  independentDeviceRefreshed: true,
                });
              }
          },
        );
        await t.test(
          'legacy sessions upgrade once and stale legacy proof still terminates the upgraded lineage',
          async () => {
            const sid = oid(),
              tid = randomUUID();
            const refreshToken = jwt.sign(
              { sub: String(user), tid },
              { secret: env.JWT_REFRESH_SECRET, expiresIn: '5m' },
            );
            const accessToken = jwt.sign(
              { sub: String(user), sid: String(sid) },
              { secret, expiresIn: '5m' },
            );
            await collection.insertOne({
              _id: sid,
              userId: user,
              tokenId: tid,
              refreshTokenHash: await bcrypt.hash(refreshToken, 4),
              expiresAt: new Date(Date.now() + 60000),
            });
            await expectStatus('GET', '/auth/me', accessToken, 200);
            const rotated = await refresh({ refreshToken });
            assert.equal(rotated.status, 200);
            await expectStatus('GET', '/auth/me', accessToken, 401);
            assert.equal((await logout({ refreshToken })).status, 204);
            await expectStatus('GET', '/auth/me', rotated.body.accessToken, 401);
            assert.equal((await refresh(rotated.body)).status, 401);
          },
        );
        await t.test(
          'invalid proof cannot revoke another login and expired proof can only revoke its own lineage',
          async () => {
            const device = await login();
            const proof = jwt.decode(device.refreshToken);
            const invalid = jwt.sign(
              { sub: String(user), tid: proof.tid, sid: proof.sid, fid: proof.fid },
              { secret: 'wrong-fixture-secret' },
            );
            assert.equal((await logout({ refreshToken: invalid })).status, 204);
            await expectStatus('GET', '/auth/me', device.accessToken, 200);
            const expired = jwt.sign(
              { sub: String(user), tid: proof.tid, sid: proof.sid, fid: proof.fid },
              { secret: env.JWT_REFRESH_SECRET, expiresIn: -1 },
            );
            assert.equal((await refresh({ refreshToken: expired })).status, 401);
            assert.equal((await logout({ refreshToken: expired })).status, 204);
            await expectStatus('GET', '/auth/me', device.accessToken, 401);
          },
        );
        const failCommand = (commands, data) =>
          connection.db.admin().command({
            configureFailPoint: 'failCommand',
            mode: { times: 2 },
            data: { failCommands: commands, appName: 'alsm-auth-race-app', ...data },
          });
        const resetFailure = () =>
          connection.db.admin().command({ configureFailPoint: 'failCommand', mode: 'off' });
        await t.test(
          'failed CAS, failed logout and unknown commit never report confirmed success or create descendants',
          async () => {
            const original = await login();
            try {
              await failCommand(['update'], { errorCode: 112 });
              const failed = await refresh(original);
              assert.equal(failed.status, 503);
              assert.equal(failed.body.code, 'REFRESH_UNAVAILABLE');
              assert.ok(!failed.body.accessToken);
              await resetFailure();
              assert.equal(await activeCount(original), 1);
              assert.equal(await collection.countDocuments(root(original)), 1);
              await expectStatus('GET', '/auth/me', original.accessToken, 200);
              await failCommand(['update'], { errorCode: 112 });
              const deniedLogout = await logout(original);
              assert.equal(deniedLogout.status, 503);
              assert.equal(deniedLogout.body.code, 'SESSION_REVOCATION_UNAVAILABLE');
              await resetFailure();
              await expectStatus('GET', '/auth/me', original.accessToken, 200);
              // The command executes but its acknowledgement is uncertain. The
              // prepared successor must not escape, and stale logout must recover.
              await failCommand(['update'], {
                writeConcernError: {
                  code: 64,
                  errmsg: 'owned fixture acknowledgement uncertainty',
                },
              });
              const uncertainRotation = await refresh(original);
              assert.equal(uncertainRotation.status, 503);
              assert.equal(uncertainRotation.body.code, 'REFRESH_UNAVAILABLE');
              assert.ok(!uncertainRotation.body.accessToken);
              await resetFailure();
              assert.equal(await collection.countDocuments(root(original)), 1);
              await expectStatus('GET', '/auth/me', original.accessToken, 401);
              assert.equal((await refresh(original)).status, 401);
              assert.equal((await logout(original)).status, 204);
              assert.equal(await activeCount(original), 0);
              const current = await login(),
                other = await login();
              await failCommand(['commitTransaction'], {
                errorCode: 1,
                errorLabels: ['UnknownTransactionCommitResult'],
              });
              const unknown = await request(
                'POST',
                '/auth/sessions/revoke-others',
                current.accessToken,
                {},
              );
              assert.equal(unknown.status, 503);
              assert.equal(unknown.body.code, 'SESSION_REVOCATION_UNAVAILABLE');
              await resetFailure();
              assert.equal(await collection.countDocuments(root(current)), 1);
              assert.equal(await collection.countDocuments(root(other)), 1);
              raceEvidence.failures.push({
                casWriteConflict: failed.status,
                logoutWriteConflict: deniedLogout.status,
                unknownCommit: unknown.status,
                appliedButUnconfirmedRotation: uncertainRotation.status,
                successorRowsCreated: 0,
                credentialsPublished: false,
              });
              // Reconciliation is an explicit new request; no business callback replay.
              await expectStatus(
                'POST',
                '/auth/sessions/revoke-others',
                current.accessToken,
                204,
                {},
              );
              await expectStatus('GET', '/auth/me', current.accessToken, 200);
              await expectStatus('GET', '/auth/me', other.accessToken, 401);
              active = current;
            } finally {
              await resetFailure();
            }
          },
        );
        fs.writeFileSync(
          path.join(evidence, 'race-results.json'),
          JSON.stringify(raceEvidence, null, 2),
        );
      }
      await t.test(
        'authoritative database outage fails closed with safe 503 and recovers',
        async () => {
          verifyServices();
          execFileSync('docker', ['stop', mongo], { windowsHide: true });
          mongoStopped = true;
          const body = await expectStatus('GET', '/auth/me', active.accessToken, 503);
          assert.equal(body.code, 'SESSION_ASSURANCE_UNAVAILABLE');
          assert.ok(!/mongodb|27137|password|stack|MongoServer/i.test(JSON.stringify(body)));
          const refreshFailure = await request('POST', '/auth/refresh', undefined, {
            refreshToken: active.refreshToken,
          });
          const logoutFailure = await request('POST', '/auth/logout', undefined, {
            refreshToken: active.refreshToken,
          });
          assert.equal(refreshFailure.status, 503);
          assert.equal(logoutFailure.status, 503);
          execFileSync('docker', ['start', mongo], { windowsHide: true });
          mongoStopped = false;
          await until(async () => {
            assert.equal((await request('GET', '/auth/me', active.accessToken)).status, 200);
          });
        },
      );
    } finally {
      if (mongoStopped) execFileSync('docker', ['start', mongo], { windowsHide: true });
      secondChild?.kill();
      if (secondChild && secondChild.exitCode === null)
        await new Promise((resolve) => secondChild.once('exit', resolve));
      child?.kill();
      if (child && child.exitCode === null)
        await new Promise((resolve) => child.once('exit', resolve));
      if (ownsDatabase) {
        verifyServices();
        assert.equal(connection.name, database);
        assert.ok(
          await connection.collection('_auth_revocation_owner').findOne({ runId, database }),
        );
        await connection.dropDatabase();
      }
      await connection.close();
      fs.writeFileSync(
        path.join(evidence, 'compiled-http-results.json'),
        JSON.stringify({ database, fixtureOnly: true, cleanedUp: ownsDatabase, proofs }, null, 2),
      );
    }
  },
);
