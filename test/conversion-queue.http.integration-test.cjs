// Opt-in UC-53 verification. Starts its own native MongoDB on an ephemeral loopback
// port. All users, jobs and statuses are disposable test fixtures, never converter output.
// Build first, then set ALSM_QUEUE_HTTP_TEST=owned-local-only and ALSM_QUEUE_MONGOD
// to an installed mongod executable. Explicit connection and provider settings
// override application .env values; external provider integrations are disabled.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { randomBytes, randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function until(work) {
  let error;
  for (let i = 0; i < 80; i++) {
    try { return await work(); } catch (failure) { error = failure; await new Promise((resolve) => setTimeout(resolve, 250)); }
  }
  throw error;
}
async function startHarness() {
  assert.equal(process.env.ALSM_QUEUE_HTTP_TEST, 'owned-local-only', 'Explicit isolated-test opt-in required');
  const binary = process.env.ALSM_QUEUE_MONGOD;
  assert.ok(binary && path.isAbsolute(binary), 'An explicit installed mongod executable is required');
  await fs.access(binary);
  const runId = randomUUID().replaceAll('-', '');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alsmv2-1038-'));
  await fs.writeFile(path.join(root, 'owner.json'), JSON.stringify({ runId, purpose: 'ALSMV2-1038 disposable integration' }));
  const port = await unusedPort();
  const database = `alsmv2_1038_${runId}`;
  const uri = `mongodb://127.0.0.1:${port}/${database}?replicaSet=queue1038`;
  const mongo = spawn(binary, ['--bind_ip', '127.0.0.1', '--port', String(port), '--dbpath', root,
    '--replSet', 'queue1038', '--logpath', path.join(root, 'mongo.log')], { windowsHide: true, stdio: 'ignore' });
  let bootstrap;
  let app;
  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    if (app) await app.close();
    if (bootstrap) await bootstrap.close();
    if (mongo.exitCode === null) {
      const stopped = new Promise((resolve) => mongo.once('exit', resolve));
      mongo.kill();
      await stopped;
    }
    // Remove only the newly created, ownership-checked temporary directory.
    const marker = JSON.parse(await fs.readFile(path.join(root, 'owner.json'), 'utf8'));
    assert.equal(marker.runId, runId);
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith('alsmv2-1038-'));
    await fs.rm(root, { recursive: true });
  }
  try {
    bootstrap = await until(() => mongoose.createConnection(`mongodb://127.0.0.1:${port}/admin?directConnection=true`, { serverSelectionTimeoutMS: 500 }).asPromise());
    await bootstrap.db.admin().command({ replSetInitiate: { _id: 'queue1038', members: [{ _id: 0, host: `127.0.0.1:${port}` }] } });
    await until(async () => assert.equal((await bootstrap.db.admin().command({ hello: 1 })).isWritablePrimary, true));
    // Explicit values take precedence over ConfigModule's .env discovery. No provider may run.
    Object.assign(process.env, {
      NODE_ENV: 'test', MONGODB_URI: uri, REDIS_HOST: '127.0.0.1', REDIS_PORT: '1', REDIS_PASSWORD: '',
      JWT_ACCESS_SECRET: randomBytes(48).toString('hex'), JWT_REFRESH_SECRET: randomBytes(48).toString('hex'),
      JWT_ACCESS_EXPIRES_IN: '15m', JWT_REFRESH_EXPIRES_IN: '1h', MFA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      CORS_ORIGINS: 'http://127.0.0.1:31038', STORAGE_ROOT: path.join(root, 'storage'),
      CONVERSION_WORKER_ENABLED: 'false', VALIDATION_WORKER_ENABLED: 'false', AI_VALIDATION_ENABLED: 'false',
      GOOGLE_CLIENT_ID: '', SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '', CASSO_API_KEY: '',
      GOOGLE_SERVICE_ACCOUNT_JSON: '', GOOGLE_CALENDAR_USER_EMAIL: '', TOOL_CONVERT_DIR: '', TOOL2JAVA_JAR_PATH: '',
      OPENAI_API_KEY: '', GEMINI_API_KEY: '',
    });
    require('reflect-metadata');
    const { NestFactory } = require('@nestjs/core');
    const { ValidationPipe } = require('@nestjs/common');
    const { getConnectionToken } = require('@nestjs/mongoose');
    const { AppModule } = require('../dist/app.module');
    const { ApiExceptionFilter } = require('../dist/shared/errors/api-exception.filter');
    app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
    app.enableCors({ origin: ['http://127.0.0.1:31038', 'http://127.0.0.1:31037'] });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.listen(0, '127.0.0.1');
    const connection = app.get(getConnectionToken());
    assert.equal(connection.name, database);
    assert.equal(connection.host, '127.0.0.1');
    const db = connection.db;
    const { ObjectId } = mongoose.Types;
    const staffId = new ObjectId(); const otherId = new ObjectId(); const viewerId = new ObjectId();
    const unassignedId = new ObjectId(); const adminId = new ObjectId(); const teamId = new ObjectId();
    const orgId = new ObjectId(); const foreignOrgId = new ObjectId(); const assignedOrgId = new ObjectId();
    const projectId = new ObjectId(); const emptyId = new ObjectId(); const foreignProjectId = new ObjectId();
    const unassignedProjectId = new ObjectId(); const assignedProjectId = new ObjectId();
    const failedId = new ObjectId(); const processingId = new ObjectId(); const completedId = new ObjectId();
    const password = randomBytes(24).toString('base64url');
    const passwordHash = await bcrypt.hash(password, 10); const now = new Date();
    const staffEmail = 'queue-staff@example.invalid';
    await db.collection('users').insertMany([
      { _id: staffId, email: staffEmail, fullName: 'Queue Staff Fixture', passwordHash, isPlatformAdmin: false, isActive: true, isEmailVerified: true, mustChangePassword: false, mfa: { enabled: false } },
      { _id: otherId, email: 'other-staff@example.invalid', fullName: 'Other Staff Fixture', passwordHash, isPlatformAdmin: false, isActive: true, isEmailVerified: true, mustChangePassword: false, mfa: { enabled: false } },
      { _id: viewerId, email: 'viewer@example.invalid', fullName: 'Viewer Fixture', passwordHash, isPlatformAdmin: false, isActive: true, isEmailVerified: true, mustChangePassword: false, mfa: { enabled: false } },
      { _id: unassignedId, email: 'unassigned-staff@example.invalid', fullName: 'Unassigned Staff Fixture', passwordHash, isPlatformAdmin: false, isActive: true, isEmailVerified: true, mustChangePassword: false, mfa: { enabled: false } },
      { _id: adminId, email: 'assignment-admin@example.invalid', fullName: 'Assignment Admin Fixture', passwordHash, isPlatformAdmin: true, isActive: true, isEmailVerified: true, mustChangePassword: false, mfa: { enabled: false } },
    ]);
    await db.collection('user_roles').insertMany([staffId, otherId, unassignedId].map((id) => ({ userId: String(id), roleId: 'CONVERSION_STAFF' })));
    await db.collection('organizations').insertMany([
      { _id: orgId, name: 'Owned queue fixture organization', type: 'INTERNAL', members: [{ userId: staffId, role: 'OWNER' }, { userId: unassignedId, role: 'MEMBER' }, { userId: adminId, role: 'ADMIN' }, { userId: viewerId, role: 'VIEWER' }] },
      { _id: foreignOrgId, name: 'Foreign fixture organization', type: 'ENTERPRISE', members: [{ userId: otherId, role: 'OWNER' }] },
      { _id: assignedOrgId, name: 'Another assigned fixture organization', type: 'ENTERPRISE', members: [{ userId: staffId, role: 'MEMBER' }] },
    ]);
    const project = (id, organizationId, name) => ({ _id: id, organizationId, name, createdBy: staffId, conversionType: 'COBOL_TO_JAVA', status: 'ACTIVE', createdAt: now, updatedAt: now });
    await db.collection('projects').insertMany([project(projectId, orgId, 'Persisted queue verification fixtures'), project(emptyId, orgId, 'Empty queue verification fixtures'), project(foreignProjectId, foreignOrgId, 'Foreign fixture project'), project(unassignedProjectId, orgId, 'Unassigned project fixture'), project(assignedProjectId, assignedOrgId, 'Another organization assigned project fixture')]);
    await db.collection('teams').insertMany([
      { _id: teamId, organizationId: orgId, name: 'Assigned Conversion Team Fixture', kind: 'CONVERSION', memberIds: [String(staffId), String(unassignedId)], managerIds: [String(adminId)],
        projectAssignments: [projectId, emptyId].map((id) => ({ projectId: String(id), memberIds: [String(staffId)] })), revision: 1, changes: [] },
      { organizationId: assignedOrgId, name: 'Other Organization Conversion Team Fixture', kind: 'CONVERSION', memberIds: [String(staffId)], managerIds: [],
        projectAssignments: [{ projectId: String(assignedProjectId), memberIds: [String(staffId)] }], revision: 1, changes: [] },
    ]);
    const { STORAGE_PORT } = require('../dist/shared/storage/storage.port');
    const resultReference = await app.get(STORAGE_PORT).writeFiles('queue-test-fixture', [{ relativePath: 'fixture.txt', content: Buffer.from('Test fixture only. No conversion was executed.\n') }]);
    await db.collection('conversion_jobs').insertMany([
      { _id: failedId, status: 'FAILED', errorCode: 'TEST_FIXTURE_FAILURE', errorMessage: 'Persisted fixture failure; no converter executed' },
      { _id: processingId, status: 'PROCESSING' }, { _id: completedId, status: 'COMPLETED', resultReference },
    ].map((record) => ({ ...record, organizationId: orgId, projectId, conversionType: 'COBOL_TO_JAVA', priority: 'NORMAL',
      attemptCount: 5, maxAttempts: 5, createdBy: staffId, createdAt: now, updatedAt: now, executionGeneration: 0 })));
    const base = `${await app.getUrl()}/api/v1`;
    let passed = 0;
    async function request(method, route, expected, token, body, org) {
      const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(org ? { 'x-organization-id': org } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      const result = await response.json();
      assert.equal(response.status, expected, `${method} ${route}: ${response.status} ${JSON.stringify(result)}`);
      passed++;
      console.log(`PASS HTTP ${response.status} ${method} ${route}`);
      return result;
    }
    const login = (email = staffEmail) => request('POST', '/auth/login', 200, undefined, { email, password });
    return { app, db, base, close, request, login, fixtureCredentials: { email: staffEmail, password }, ids: Object.fromEntries(Object.entries({ staffId, otherId, unassignedId, adminId, teamId, orgId, foreignOrgId, assignedOrgId, projectId, emptyId, foreignProjectId, unassignedProjectId, assignedProjectId, failedId, processingId, completedId }).map(([key, value]) => [key, String(value)])), getPassed: () => passed };
  } catch (error) { await close(); throw error; }
}
async function main() {
  if (process.env.ALSM_QUEUE_HTTP_TEST !== 'owned-local-only') { console.log('SKIP: explicit isolated-test opt-in required'); return; }
  const h = await startHarness();
  try {
    const { request, db, ids, login } = h;
    const staff = await login(); const outsider = await login('other-staff@example.invalid'); const viewer = await login('viewer@example.invalid');
    const me = await request('GET', '/auth/me', 200, staff.accessToken);
    assert.ok(me.roles.includes('CONVERSION_STAFF')); assert.ok(me.effectivePermissions.includes('conversions.queue.view')); assert.equal(me.isPlatformAdmin, false);
    const projects = await request('GET', '/projects', 200, staff.accessToken);
    assert.equal(projects.length, 3); assert.ok(!projects.some((p) => p.id === ids.foreignProjectId));
    const assigned = await request('GET', '/conversion-queue/projects', 200, staff.accessToken);
    assert.deepEqual(assigned.map((p) => p.id).sort(), [ids.projectId, ids.emptyId, ids.assignedProjectId].sort());
    assert.ok(!assigned.some((p) => p.id === ids.unassignedProjectId));
    assert.deepEqual(await request('GET', `/projects/${ids.assignedProjectId}/conversions`, 200, staff.accessToken, undefined, ids.assignedOrgId), []);
    const jobs = await request('GET', `/projects/${ids.projectId}/conversions`, 200, staff.accessToken);
    assert.deepEqual(jobs.map((job) => job.status).sort(), ['COMPLETED', 'FAILED', 'PROCESSING']);
    assert.ok(jobs.every((job) => job.organizationId === ids.orgId && job.attemptCount === 5));
    const detail = await request('GET', `/conversions/${ids.failedId}`, 200, staff.accessToken);
    assert.equal(detail.errorCode, 'TEST_FIXTURE_FAILURE'); assert.equal(detail.logs, undefined);
    assert.deepEqual(await request('GET', `/projects/${ids.emptyId}/conversions`, 200, staff.accessToken), []);
    await request('GET', `/projects/${ids.projectId}/conversions`, 401);
    await request('GET', `/projects/${ids.foreignProjectId}/conversions`, 403, staff.accessToken);
    await request('GET', `/projects/${ids.projectId}/conversions`, 403, outsider.accessToken);
    await request('GET', `/projects/${ids.foreignProjectId}/conversions`, 403, staff.accessToken, undefined, ids.foreignOrgId);
    await request('GET', `/conversions/${ids.failedId}`, 404, outsider.accessToken);
    await request('GET', '/projects/invalid-id/conversions', 403, staff.accessToken);
    const unassigned = await login('unassigned-staff@example.invalid');
    assert.deepEqual(await request('GET', '/conversion-queue/projects', 200, unassigned.accessToken), []);
    await request('GET', `/projects/${ids.projectId}/conversions`, 403, unassigned.accessToken);
    await request('GET', `/projects/${ids.unassignedProjectId}/conversions`, 403, staff.accessToken);
    await request('GET', `/conversions/${ids.failedId}`, 403, unassigned.accessToken);
    await request('GET', `/projects/${ids.projectId}/screens/fixture/conversions`, 403, unassigned.accessToken);
    await request('GET', `/conversions/${ids.completedId}/result`, 403, unassigned.accessToken);
    await request('GET', `/projects/${ids.projectId}/conversions/${ids.completedId}/quality-review`, 403, unassigned.accessToken);
    await request('PATCH', `/projects/${ids.projectId}/conversions/${ids.completedId}/quality-review`, 403, unassigned.accessToken, { status: 'ACCEPTED' });
    await request('POST', `/conversions/${ids.failedId}/retry`, 403, unassigned.accessToken);
    await request('GET', `/conversions/${ids.completedId}/result`, 200, staff.accessToken);
    await request('GET', `/projects/${ids.projectId}/conversions/${ids.completedId}/quality-review`, 200, staff.accessToken);
    await request('GET', `/projects/${ids.projectId}/conversions`, 200, viewer.accessToken); // unchanged customer read
    await request('GET', '/conversion-queue/projects', 403, viewer.accessToken);
    await request('POST', `/conversions/${ids.failedId}/retry`, 403, viewer.accessToken);
    await request('POST', `/conversions/${ids.completedId}/retry`, 404, staff.accessToken);
    await request('POST', `/conversions/${ids.failedId}/retry`, 400, staff.accessToken); // real disabled-queue failure
    const afterRetry = await request('GET', `/conversions/${ids.failedId}`, 200, staff.accessToken);
    assert.equal(afterRetry.status, 'FAILED'); assert.equal(afterRetry.errorCode, 'CONVERSION_QUEUE_UNAVAILABLE'); assert.equal(afterRetry.executionGeneration, 1);
    const { MongoConversionJobRepository } = require('../dist/modules/conversions/infrastructure/mongo-conversion-job.repository');
    const { getModelToken } = require('@nestjs/mongoose');
    const { ConversionJob } = require('../dist/modules/conversions/infrastructure/conversion-job.schema');
    const repository = new MongoConversionJobRepository(h.app.get(getModelToken(ConversionJob.name)));
    // Competing claims on a real Mongo record prove reads cannot manufacture a transition.
    const claims = await Promise.all([repository.retry(ids.failedId, ids.orgId), repository.retry(ids.failedId, ids.orgId)]);
    assert.equal(claims.filter(Boolean).length, 1);
    const winner = claims.find(Boolean);
    const reloaded = await request('GET', `/conversions/${ids.failedId}`, 200, staff.accessToken);
    assert.equal(reloaded.status, winner.status); assert.equal(reloaded.executionGeneration, winner.executionGeneration);
    console.log('PASS Mongo atomic retry: exactly one winner; HTTP reports the persisted generation (no Redis enqueue claimed)');
    const sid = JSON.parse(Buffer.from(staff.accessToken.split('.')[1], 'base64url')).sid;
    await db.collection('user_sessions').updateOne({ _id: new mongoose.Types.ObjectId(sid) }, { $set: { revokedAt: new Date() } });
    await request('GET', `/projects/${ids.projectId}/conversions`, 401, staff.accessToken);
    await request('GET', '/conversion-queue/projects', 401, staff.accessToken);
    await request('GET', `/conversions/${ids.failedId}`, 401, staff.accessToken);
    await request('POST', `/conversions/${ids.failedId}/retry`, 401, staff.accessToken);
    const session = await login();
    const refreshed = await request('POST', '/auth/refresh', 200, undefined, { refreshToken: session.refreshToken });
    await request('GET', `/projects/${ids.projectId}/conversions`, 200, refreshed.accessToken);
    const admin = await login('assignment-admin@example.invalid');
    const replace = (projectAssignments) => request('PUT', `/teams/${ids.teamId}`, 200, admin.accessToken, {
      name: 'Assigned Conversion Team Fixture', kind: 'CONVERSION', memberIds: [ids.staffId, ids.unassignedId],
      managerIds: [ids.adminId], projectAssignments, expectedRevision: 1,
    }, ids.orgId);
    await replace([{ projectId: ids.emptyId, memberIds: [ids.staffId] }]);
    // The same live JWT and organization OWNER membership must no longer grant the project.
    await request('GET', `/projects/${ids.projectId}/conversions`, 403, refreshed.accessToken);
    await request('GET', `/conversions/${ids.failedId}`, 403, refreshed.accessToken);
    await request('GET', `/conversions/${ids.completedId}/result`, 403, refreshed.accessToken);
    await request('GET', `/projects/${ids.projectId}/screens/fixture/conversions`, 403, refreshed.accessToken);
    await request('GET', `/projects/${ids.projectId}/conversions/${ids.completedId}/quality-review`, 403, refreshed.accessToken);
    await request('PATCH', `/projects/${ids.projectId}/conversions/${ids.completedId}/quality-review`, 403, refreshed.accessToken, { status: 'ACCEPTED' });
    await request('POST', `/conversions/${ids.failedId}/retry`, 403, refreshed.accessToken);
    const afterRevocation = await request('GET', '/conversion-queue/projects', 200, refreshed.accessToken);
    assert.ok(!afterRevocation.some((project) => project.id === ids.projectId));
    console.log(`PASS: ${h.getPassed()} HTTP checks; real isolated MongoDB and production AppModule. Redis enqueue success is not verified.`);
  } finally { await h.close(); }
}
module.exports = { startHarness };
if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1; });
