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

const mongo = 'alsm-auth-revocation-20261017-mongo';
function verifyServices(running = true) {
  for (const [name, owner, inside, outside, expectedRunning] of [
    [mongo, 'auth-revocation-20261017', '27017/tcp', '27137', running],
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
    timeout: 120000,
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
    const evidence = path.resolve(__dirname, '../coverage/auth-revocation');
    fs.mkdirSync(evidence, { recursive: true });
    const uri = `mongodb://127.0.0.1:27137/${database}?replicaSet=alsmAuthRevocation&directConnection=true`;
    const connection = await mongoose
      .createConnection(uri, { serverSelectionTimeoutMS: 5000, autoIndex: false })
      .asPromise();
    let child,
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
      MONGODB_URI: uri,
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
    async function request(method, route, token, body, tenant = String(organization)) {
      const response = await fetch('http://127.0.0.1:3119/api/v1' + route, {
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
      assert.equal(
        (await connection.db.admin().command({ hello: 1 })).setName,
        'alsmAuthRevocation',
      );
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
          assert.ok(claims(active).sid !== claims(old).sid);
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
        'authoritative database outage fails closed with safe 503 and recovers',
        async () => {
          verifyServices();
          execFileSync('docker', ['stop', mongo], { windowsHide: true });
          mongoStopped = true;
          const body = await expectStatus('GET', '/auth/me', active.accessToken, 503);
          assert.equal(body.code, 'SESSION_ASSURANCE_UNAVAILABLE');
          assert.ok(!/mongodb|27137|password|stack|MongoServer/i.test(JSON.stringify(body)));
          execFileSync('docker', ['start', mongo], { windowsHide: true });
          mongoStopped = false;
          await until(async () => {
            assert.equal((await request('GET', '/auth/me', active.accessToken)).status, 200);
          });
        },
      );
    } finally {
      if (mongoStopped) execFileSync('docker', ['start', mongo], { windowsHide: true });
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
