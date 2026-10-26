// Owned isolated full-AppModule verification. All records are labeled test fixtures.
const path = require('node:path');
const fs = require('node:fs/promises');
const { randomUUID, randomBytes } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const http = require('node:http');
const workspace = 'E:/ALSM/ALSM_WEB_BE';
const evidence = path.join(workspace, 'coverage/updated-priorities/browser');
const assert = require('node:assert/strict');
const { setup } = require('./team-dev-indexes.cjs');
const runId = randomUUID().replaceAll('-', '');
const databaseName = `alsm_team_dev_${runId}`;
function verify() {
  for (const [name, owner, internal, external] of [
    ['alsm-priorities-20261017-mongo-rs', 'priorities-20261017', '27017/tcp', '27127'],
    ['alsm-emergency-20261017-browser-redis', 'emergency-20261017', '6379/tcp', '6398'],
  ]) {
    const [info] = JSON.parse(
      execFileSync('docker', ['inspect', name], { encoding: 'utf8', windowsHide: true }),
    );
    const bindings = info.NetworkSettings.Ports[internal];
    if (
      !info.State.Running ||
      info.Config.Labels['alsm.owner'] !== owner ||
      bindings?.length !== 1 ||
      bindings[0].HostIp !== '127.0.0.1' ||
      bindings[0].HostPort !== external
    )
      throw new Error('Ownership mismatch');
  }
}
verify();
process.chdir(workspace);
Object.assign(process.env, {
  NODE_ENV: 'test',
  MONGODB_URI: `mongodb://127.0.0.1:27127/${databaseName}?replicaSet=alsmPriorities&directConnection=true`,
  REDIS_HOST: '127.0.0.1',
  REDIS_PORT: '6398',
  REDIS_PASSWORD: '',
  JWT_ACCESS_SECRET: randomBytes(48).toString('hex'),
  JWT_REFRESH_SECRET: randomBytes(48).toString('hex'),
  JWT_ACCESS_EXPIRES_IN: '15m',
  JWT_REFRESH_EXPIRES_IN: '1h',
  MFA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  CORS_ORIGINS: 'http://127.0.0.1:3012',
  STORAGE_ROOT: path.join(evidence, 'browser-storage', runId),
  GOOGLE_SERVICE_ACCOUNT_JSON: '',
  GOOGLE_CALENDAR_USER_EMAIL: '',
  SMTP_HOST: '',
  SMTP_USER: '',
  SMTP_PASS: '',
  CONVERSION_WORKER_ENABLED: 'false',
  VALIDATION_WORKER_ENABLED: 'false',
  AI_VALIDATION_ENABLED: 'false',
  OPENAI_API_KEY: '',
  GEMINI_API_KEY: '',
});
const req = (name) => require(path.join(workspace, 'node_modules', name));
req('reflect-metadata');
const { NestFactory } = req('@nestjs/core');
const { ValidationPipe } = req('@nestjs/common');
const { getConnectionToken } = req('@nestjs/mongoose');
const { Types, createConnection } = req('mongoose');
const bcrypt = req('bcrypt');
const { AppModule } = require(path.join(workspace, 'dist/app.module'));
const { ApiExceptionFilter } = require(
  path.join(workspace, 'dist/shared/errors/api-exception.filter'),
);
req('mongoose').set('autoIndex', false);

let liveApp;
async function main() {
  await fs.mkdir(evidence, { recursive: true });
  const firstIndexes = await setup(databaseName, { replicaSet: true });
  assert.deepEqual(await setup(databaseName, { replicaSet: true }), firstIndexes);
  await fs.writeFile(
    path.join(evidence, 'startup-indexes.json'),
    JSON.stringify(firstIndexes, null, 2),
  );
  let app, connection, db;
  async function start() {
    app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
    liveApp = app;
    app.enableCors({ origin: 'http://127.0.0.1:3012' });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
    connection = app.get(getConnectionToken());
    if (
      connection.name !== databaseName ||
      connection.host !== '127.0.0.1' ||
      connection.port !== 27127 ||
      (await connection.db.admin().command({ hello: 1 })).setName !== 'alsmPriorities'
    )
      throw new Error('Unsafe application DB');
    db = connection.db;
    await app.listen(3107, '127.0.0.1');
  }
  await start();
  const userId = new Types.ObjectId(),
    staffId = new Types.ObjectId(),
    organizationId = new Types.ObjectId(),
    projectId = new Types.ObjectId(),
    adminId = new Types.ObjectId(),
    otherId = new Types.ObjectId(),
    foreignId = new Types.ObjectId(),
    foreignOrgId = new Types.ObjectId(),
    customerId = new Types.ObjectId();
  const password = randomBytes(24).toString('base64url'),
    email = 'team-browser-fixture@example.invalid';
  const now = new Date();
  const passwordHash = await bcrypt.hash(password, 10);
  await db.collection('users').insertMany([
    {
      _id: userId,
      email,
      fullName: 'TEST FIXTURE --- Team Manager',
      passwordHash,
      isActive: true,
      isEmailVerified: true,
      isPlatformAdmin: false,
      mustChangePassword: false,
      mfa: { enabled: false },
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: staffId,
      email: 'team-staff-fixture@example.invalid',
      passwordHash,
      fullName: 'TEST FIXTURE --- Assigned Staff',
      isActive: true,
      isEmailVerified: true,
      isPlatformAdmin: false,
      mustChangePassword: false,
      mfa: { enabled: false },
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.collection('users').insertMany(
    [
      [adminId, 'admin'],
      [otherId, 'other-manager'],
      [foreignId, 'foreign'],
      [customerId, 'customer'],
    ].map(([id, label]) => ({
      _id: id,
      email: `team-${label}-fixture@example.invalid`,
      fullName: `TEST FIXTURE - ${label}`,
      passwordHash,
      isActive: true,
      isEmailVerified: true,
      isPlatformAdmin: false,
      mustChangePassword: false,
      mfa: { enabled: false },
      createdAt: now,
      updatedAt: now,
    })),
  );
  await db
    .collection('user_roles')
    .insertMany([userId, adminId].map((id) => ({ userId: String(id), roleId: 'TEAM_LEAD' })));
  await db.collection('organizations').insertOne({
    _id: organizationId,
    name: 'TEST FIXTURE --- Owned Organization',
    type: 'INTERNAL',
    members: [
      { userId, role: 'OWNER' },
      { userId: staffId, role: 'MEMBER' },
      { userId: adminId, role: 'ADMIN' },
      { userId: otherId, role: 'MEMBER' },
      { userId: customerId, role: 'MEMBER' },
    ],
    createdAt: now,
    updatedAt: now,
  });
  await db.collection('projects').insertOne({
    _id: projectId,
    organizationId,
    createdBy: userId,
    name: 'TEST FIXTURE --- Workload Records',
    conversionType: 'COBOL_TO_JAVA',
    status: 'ACTIVE',
    createdAt: now,
    updatedAt: now,
  });
  await db.collection('organizations').insertOne({
    _id: foreignOrgId,
    name: 'TEST FIXTURE - Foreign Organization',
    type: 'INTERNAL',
    members: [{ userId: foreignId, role: 'OWNER' }],
    createdAt: now,
    updatedAt: now,
  });
  const proofs = [];
  async function login(selectedEmail) {
    const response = await fetch('http://127.0.0.1:3107/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: selectedEmail, password }),
    });
    assert.equal(response.status, 200, `Fixture login ${selectedEmail}: ${response.status}`);
    return response.json();
  }
  const tokens = await login('team-admin-fixture@example.invalid');
  const managerTokens = await login(email),
    memberTokens = await login('team-staff-fixture@example.invalid'),
    foreignTokens = await login('team-foreign-fixture@example.invalid');
  async function api(
    method,
    route,
    body,
    auth = tokens,
    org = String(organizationId),
    expected = method === 'POST' ? 201 : 200,
  ) {
    const response = await fetch('http://127.0.0.1:3107/api/v1' + route, {
      method,
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        'Content-Type': 'application/json',
        'x-organization-id': org,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await response.json();
    assert.equal(
      response.status,
      expected,
      `${method} ${route}: ${payload.code || response.status}`,
    );
    proofs.push({ method, route, status: response.status });
    return payload;
  }
  const createTeam = (body) =>
    api('POST', '/teams', { ...body, creationId: new Types.ObjectId().toHexString() });
  const assignJob = (teamId, jobId, memberId) =>
    api('POST', `/teams/${teamId}/job-assignments`, {
      assignmentId: new Types.ObjectId().toHexString(),
      jobId,
      memberId,
    });

  const sales = await createTeam({
    name: 'TEST FIXTURE --- Sales Team',
    kind: 'SALES',
    memberIds: [String(staffId), String(otherId)],
    managerIds: [String(userId)],
    projectAssignments: [],
    expectedRevision: 0,
  });
  const oid = () => new Types.ObjectId().toHexString();
  const createLead = (salespersonId) =>
    api('POST', '/sales/leads', {
      leadId: oid(),
      assignmentId: oid(),
      teamId: sales.id,
      salespersonId: String(salespersonId),
      title: 'TEST FIXTURE sourced lead',
      sourceReference: `TEST-FIXTURE/${oid()}`,
    });
  let firstLead = await createLead(staffId);
  firstLead = await api('POST', `/sales/leads/${firstLead.id}/assignments`, {
    assignmentId: oid(),
    teamId: sales.id,
    salespersonId: String(otherId),
    expectedRevision: firstLead.revision,
  });
  firstLead = await api('POST', `/sales/leads/${firstLead.id}/customer-conversions`, {
    conversionId: oid(),
    customerUserId: String(customerId),
    reference: `TEST-FIXTURE/${oid()}`,
    expectedRevision: firstLead.revision,
  });
  await api('POST', `/sales/leads/${firstLead.id}/assignments`, {
    assignmentId: oid(),
    teamId: sales.id,
    salespersonId: String(staffId),
    expectedRevision: firstLead.revision,
  });
  await createLead(staffId);
  const thirdLead = await createLead(otherId);
  await api('POST', `/sales/leads/${thirdLead.id}/customer-conversions`, {
    conversionId: oid(),
    customerUserId: String(customerId),
    reference: `TEST-FIXTURE/${oid()}`,
    expectedRevision: thirdLead.revision,
  });
  for (const [salespersonId, amountVnd] of [
    [staffId, 125000],
    [otherId, 275000],
  ]) {
    const paymentId = new Types.ObjectId();
    // Explicit synthetic confirmed-transaction fixtures in this disposable test DB only.
    await db.collection('payments').insertOne({
      _id: paymentId,
      organizationId,
      userId: customerId,
      planTier: 'STARTER',
      status: 'COMPLETED',
      amountVnd,
      paidAt: new Date(),
      cassoTransactionId: `TEST-FIXTURE-${paymentId}`,
      referenceCode: `TEST-FIXTURE-${paymentId}`,
      bankName: 'TEST FIXTURE',
      accountNumber: 'TEST-ONLY',
      accountName: 'TEST FIXTURE',
      expiresAt: new Date(Date.now() + 60000),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await api('POST', '/sales/revenue-attributions', {
      paymentId: String(paymentId),
      teamId: sales.id,
      salespersonId: String(salespersonId),
      evidenceReference: `TEST-FIXTURE/${paymentId}`,
    });
  }
  const conversion = await createTeam({
    name: 'TEST FIXTURE --- Conversion Team',
    kind: 'CONVERSION',
    memberIds: [String(staffId)],
    managerIds: [String(userId)],
    projectAssignments: [{ projectId: String(projectId), memberIds: [String(staffId)] }],
    expectedRevision: 0,
  });
  const jobIds = [];
  for (const [index, status] of [
    'QUEUED',
    'PROCESSING',
    'COMPLETED',
    'FAILED',
    'COMPLETED',
  ].entries()) {
    const id = new Types.ObjectId();
    jobIds.push(String(id));
    await db.collection('conversion_jobs').insertOne({
      _id: id,
      organizationId,
      projectId,
      conversionType: 'COBOL_TO_JAVA',
      status,
      priority: 'NORMAL',
      attemptCount: 3,
      maxAttempts: 3,
      executionGeneration: 0,
      createdBy: userId,
      toolVersion: 'TEST FIXTURE --- not converter evidence',
      createdAt: new Date(Date.now() - (index === 4 ? 10 : 1) * 86400000),
      updatedAt: now,
    });
    await assignJob(conversion.id, String(id), String(staffId));
  }
  const emptySales = await createTeam({
    name: 'TEST FIXTURE - Empty Sales',
    kind: 'SALES',
    memberIds: [],
    managerIds: [String(userId)],
    projectAssignments: [],
    expectedRevision: 0,
  });
  const emptyConversion = await createTeam({
    name: 'TEST FIXTURE - Zero Assigned Jobs',
    kind: 'CONVERSION',
    memberIds: [String(staffId)],
    managerIds: [String(userId)],
    projectAssignments: [{ projectId: String(projectId), memberIds: [String(staffId)] }],
    expectedRevision: 0,
  });
  const isolated = await createTeam({
    name: 'TEST FIXTURE - Other Manager Only',
    kind: 'CONVERSION',
    memberIds: [String(staffId)],
    managerIds: [String(otherId)],
    projectAssignments: [],
    expectedRevision: 0,
  });
  const salesState = await api('GET', `/teams/${sales.id}/administration`);
  await api('PUT', `/teams/${sales.id}`, {
    name: salesState.name,
    kind: salesState.kind,
    memberIds: salesState.memberIds,
    managerIds: salesState.managerIds,
    projectAssignments: salesState.projectAssignments,
    expectedRevision: salesState.revision,
  });
  async function verifyReports(phase) {
    const seven = await api(
      'GET',
      `/teams/${conversion.id}/workload?days=7`,
      undefined,
      managerTokens,
    );
    assert.deepEqual(seven.totals, {
      assignedJobs: 4,
      processingJobs: 1,
      completedJobs: 1,
      failedJobs: 1,
    });
    const thirty = await api(
      'GET',
      `/teams/${conversion.id}/workload?days=30`,
      undefined,
      managerTokens,
    );
    assert.deepEqual(thirty.totals, {
      assignedJobs: 5,
      processingJobs: 1,
      completedJobs: 2,
      failedJobs: 1,
    });
    const performance = await api(
      'GET',
      `/teams/${sales.id}/performance?days=7`,
      undefined,
      managerTokens,
    );
    assert.equal(performance.members.length, 2);
    assert.equal(performance.cohort, 'ASSIGNMENT_START');
    assert.equal(performance.metrics.leadCount.value, 3);
    assert.ok(Math.abs(performance.metrics.conversionRate.value - 200 / 3) < 0.000001);
    assert.equal(performance.metrics.revenueGenerated.value, 400000);
    for (const [seller, rate, amount] of [
      [staffId, 0, 125000],
      [otherId, 100, 275000],
    ]) {
      const row = performance.members.find((member) => member.userId === String(seller));
      assert.equal(row.metrics.leadCount.value, 2);
      assert.equal(row.metrics.conversionRate.value, rate);
      assert.equal(row.metrics.revenueGenerated.value, amount);
    }
    const thirtySales = await api(
      'GET',
      `/teams/${sales.id}/performance?days=30`,
      undefined,
      managerTokens,
    );
    assert.deepEqual(thirtySales.metrics, performance.metrics);
    assert.equal(
      (await api('GET', `/teams/${emptySales.id}/performance?days=7`, undefined, managerTokens))
        .members.length,
      0,
    );
    assert.deepEqual(
      (await api('GET', `/teams/${emptyConversion.id}/workload?days=7`, undefined, managerTokens))
        .totals,
      { assignedJobs: 0, processingJobs: 0, completedJobs: 0, failedJobs: 0 },
    );
    await api(
      'GET',
      `/teams/${isolated.id}/workload?days=7`,
      undefined,
      managerTokens,
      String(organizationId),
      404,
    );
    await api(
      'GET',
      `/teams/${conversion.id}/workload?days=7`,
      undefined,
      memberTokens,
      String(organizationId),
      404,
    );
    await api(
      'GET',
      `/teams/${conversion.id}/workload?days=7`,
      undefined,
      foreignTokens,
      String(organizationId),
      403,
    );
    await api(
      'GET',
      `/teams/${conversion.id}/workload?days=7`,
      undefined,
      managerTokens,
      String(foreignOrgId),
      403,
    );
    await api(
      'GET',
      `/teams/${sales.id}/administration`,
      undefined,
      memberTokens,
      String(organizationId),
      403,
    );
    await fs.writeFile(
      path.join(evidence, `startup-${phase}.json`),
      JSON.stringify(
        {
          phase,
          persisted: true,
          fixtureData: true,
          reports: { seven, thirty, performance, thirtySales },
          proofs,
        },
        null,
        2,
      ),
    );
  }
  await verifyReports('initial');
  await app.close();
  await start();
  await verifyReports('restarted');
  const helper = http.createServer(async (request, response) => {
    if (request.url === '/sign-in' || request.url === '/sign-in/member') {
      const result = await fetch('http://127.0.0.1:3107/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: request.url.endsWith('/member') ? 'team-staff-fixture@example.invalid' : email,
          password,
        }),
      });
      if (!result.ok) {
        response.writeHead(500).end(`Fixture login failed: ${result.status}`);
        return;
      }
      const tokens = await result.json();
      const callback = new URL('http://127.0.0.1:3012/auth/callback');
      callback.searchParams.set('access_token', tokens.accessToken);
      callback.searchParams.set('refresh_token', tokens.refreshToken);
      response.writeHead(302, { Location: callback.href, 'Cache-Control': 'no-store' }).end();
      return;
    }
    if (request.method === 'POST' && request.url === `/revoke-scope/${runId}`) {
      const state = await api('GET', `/teams/${conversion.id}/administration`);
      await api('PUT', `/teams/${conversion.id}`, {
        name: state.name,
        kind: state.kind,
        memberIds: state.memberIds,
        managerIds: [],
        projectAssignments: state.projectAssignments,
        expectedRevision: state.revision,
      });
      response.writeHead(200).end('Explicit manager scope revoked via authorized API');
      return;
    }
    if (request.method === 'POST' && request.url === `/shutdown/${runId}`) {
      verify();
      const marker = await db
        .collection('_team_dev_owner')
        .findOne({ owner: 'team-readiness-indexes-v1', database: databaseName });
      if (!marker || connection.name !== `alsm_team_dev_${runId}`)
        throw new Error('Unsafe cleanup');
      await connection.dropDatabase();
      response.writeHead(200).end('Owned test database removed');
      helper.close();
      await app.close();
      process.exit(0);
    }
    response.writeHead(404).end();
  });
  helper.listen(3108, '127.0.0.1');
  await fs.writeFile(
    path.join(evidence, 'browser-runtime.json'),
    JSON.stringify(
      {
        runId,
        databaseName,
        salesTeamId: sales.id,
        conversionTeamId: conversion.id,
        emptySalesTeamId: emptySales.id,
        emptyConversionTeamId: emptyConversion.id,
        isolatedTeamId: isolated.id,
        restarted: true,
        userId: String(userId),
        staffId: String(staffId),
        organizationId: String(organizationId),
        projectId: String(projectId),
        jobIds,
        signIn: 'http://127.0.0.1:3108/sign-in',
        frontend: 'http://127.0.0.1:3012',
        realConverterSuccess: false,
        fixtureData: true,
      },
      null,
      2,
    ),
  );
  console.log(
    'TEAM_BROWSER_READY --- full AppModule, normal login, owned fixture data; no converter/AI/production access.',
  );
}
main().catch(async (error) => {
  console.error(error.message);
  await liveApp?.close();
  verify();
  const cleanup = await createConnection(process.env.MONGODB_URI).asPromise();
  if (
    cleanup.name === databaseName &&
    (await cleanup
      .collection('_team_dev_owner')
      .findOne({ owner: 'team-readiness-indexes-v1', database: databaseName }))
  )
    await cleanup.dropDatabase();
  await cleanup.close();
  process.exitCode = 1;
});
