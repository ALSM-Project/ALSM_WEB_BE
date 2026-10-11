import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { Connection, Model, Types } from 'mongoose';
import { ConversionType } from '../src/modules/projects/domain/project.types';
import { CONVERSION_QUEUE } from '../src/modules/conversions/domain/conversion-job.types';
import {
  VALIDATION_REPOSITORY,
  ValidationRepository,
  FindingStatus,
} from '../src/modules/conversions/domain/validation.types';
import {
  LegacyValidationFinding,
  LegacyValidationRun,
} from '../src/modules/conversions/infrastructure/validation.schema';
import { ValidationFinding } from '../src/modules/validation/infrastructure/validation-finding.schema';
import { ValidationRun } from '../src/modules/validation/infrastructure/validation-run.schema';
import { VALIDATION_QUEUE } from '../src/modules/validation/domain/validation-queue.port';

// Opt in only against a disposable local database. Never use the application URI.
const uri = process.env.LEGACY_VALIDATION_TEST_MONGODB_URI;
const integration = uri ? describe : describe.skip;

integration('legacy validation isolation (real AppModule, HTTP and MongoDB)', () => {
  let app: INestApplication;
  let connection: Connection;
  let baseUrl: string;
  let jwt: JwtService;
  const previousEnvironment = { ...process.env };
  const secret = 'legacy-validation-test-secret-32-characters';
  const user = new Types.ObjectId();
  const outsider = new Types.ObjectId();
  const org = new Types.ObjectId();
  const otherOrg = new Types.ObjectId();
  const project = new Types.ObjectId();
  const screen = new Types.ObjectId();
  const job = new Types.ObjectId();
  const queue = { enqueue: jest.fn().mockResolvedValue(undefined) };
  const collections = [
    'organizations',
    'projects',
    'screens',
    'conversion_jobs',
    'validation_runs',
    'validation_findings',
    'audit_logs',
    'field_mappings',
  ];

  beforeAll(async () => {
    if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/alsm_legacy_validation_test_[a-z\d_]+$/.test(uri!)) {
      throw new Error('Use a disposable loopback database named alsm_legacy_validation_test_*');
    }
    Object.assign(process.env, {
      NODE_ENV: 'production',
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
      .overrideProvider(CONVERSION_QUEUE)
      .useValue(queue)
      .overrideProvider(VALIDATION_QUEUE)
      .useValue({ enqueue: jest.fn() })
      .compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
    connection = app.get(getConnectionToken());
    jwt = app.get(JwtService);
  }, 30000);

  afterAll(async () => {
    // The URI guard above limits cleanup to this explicitly disposable database.
    if (connection) await connection.dropDatabase();
    if (app) await app.close();
    process.env = previousEnvironment;
  });

  beforeEach(async () => {
    for (const name of collections) await connection.collection(name).deleteMany({});
    queue.enqueue.mockClear();
    await connection.collection('organizations').insertMany([
      { _id: org, name: 'A', type: 'ENTERPRISE', members: [{ userId: user, role: 'MEMBER' }] },
      {
        _id: otherOrg,
        name: 'B',
        type: 'ENTERPRISE',
        members: [{ userId: outsider, role: 'OWNER' }],
      },
    ]);
    await connection.collection('projects').insertOne({
      _id: project,
      organizationId: org,
      conversionType: ConversionType.BMS_DSPF_TO_FRONTEND,
      name: 'BMS',
      status: 'ACTIVE',
      createdBy: user,
    });
    await connection.collection('screens').insertOne({
      _id: screen,
      organizationId: org,
      projectId: project,
      name: 'SCREEN.bms',
      sourceType: 'BMS',
      inputReference: 'test.bms',
      status: 'READY',
      createdBy: user,
    });
    await connection.collection('conversion_jobs').insertOne({
      _id: job,
      organizationId: org,
      projectId: project,
      screenId: screen.toString(),
      conversionType: ConversionType.BMS_DSPF_TO_FRONTEND,
      status: 'COMPLETED',
      priority: 'NORMAL',
      attemptCount: 0,
      maxAttempts: 3,
      createdBy: user,
    });
  });

  const getPath = (p = project.toString(), s = screen.toString(), j = job.toString()) =>
    `/projects/${p}/screens/${encodeURIComponent(s)}/conversions/${j}/validation`;
  async function request(
    path: string,
    method = 'GET',
    options: { org?: string; token?: string | null; body?: object } = {},
  ) {
    const token =
      options.token === undefined
        ? jwt.sign(
            { sub: user.toString(), email: 'test@example.com', isPlatformAdmin: false },
            { secret },
          )
        : options.token;
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.org !== undefined ? { 'x-organization-id': options.org } : {}),
        'Content-Type': 'application/json',
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
    return { status: response.status, body: await response.json() };
  }
  async function legacy() {
    const result = await request(getPath());
    expect(result.status).toBe(200);
    return result.body as { run: { id: string }; findings: { id: string; status: string }[] };
  }
  async function ai(organizationId = org) {
    const run = await app.get<Model<ValidationRun>>(getModelToken(ValidationRun.name)).create({
      organizationId,
      projectId: project,
      conversionJobId: job,
      screenId: screen.toString(),
      status: 'COMPLETED',
      aiValidationEnabled: true,
      ruleValidationEnabled: false,
      findingCount: 1,
    });
    const finding = await app
      .get<Model<ValidationFinding>>(getModelToken(ValidationFinding.name))
      .create({
        organizationId,
        projectId: project,
        conversionJobId: job,
        validationRunId: run._id,
        screenId: screen.toString(),
        source: 'AI',
        category: 'LOGIC_MISMATCH',
        severity: 'HIGH',
        status: 'PENDING',
        title: 'AI finding',
        explanation: 'Synthetic fixture',
      });
    return { run, finding };
  }
  async function snapshot() {
    return Promise.all(
      ['validation_findings', 'validation_runs', 'audit_logs'].map((name) =>
        connection.collection(name).find({}).sort({ _id: 1 }).toArray(),
      ),
    );
  }

  it('registers distinct legacy and AI schemas on the original shared collections', () => {
    for (const [legacyName, aiName, collection] of [
      [LegacyValidationRun.name, ValidationRun.name, 'validation_runs'],
      [LegacyValidationFinding.name, ValidationFinding.name, 'validation_findings'],
    ]) {
      const legacyModel = app.get<Model<unknown>>(getModelToken(legacyName));
      const aiModel = app.get<Model<unknown>>(getModelToken(aiName));
      expect(legacyModel).not.toBe(aiModel);
      expect(legacyModel.collection.name).toBe(collection);
      expect(aiModel.collection.name).toBe(collection);
    }
    expect(
      app.get<Model<unknown>>(getModelToken(LegacyValidationFinding.name)).schema.path('issueType'),
    ).toBeDefined();
    expect(
      app.get<Model<unknown>>(getModelToken(ValidationFinding.name)).schema.path('category'),
    ).toBeDefined();
  });

  it.each(['BMS', 'DSPF'])(
    'preserves %s lazy creation, cached reads, accept/reject metadata and audit',
    async (sourceType) => {
      await connection.collection('screens').updateOne({ _id: screen }, { $set: { sourceType } });
      const created = await legacy();
      expect(created.findings).toHaveLength(1);
      const read = await legacy();
      expect(read.run.id).toBe(created.run.id);
      for (const [action, status] of [
        ['accept', 'CONFIRMED'],
        ['reject', 'REJECTED'],
      ]) {
        const result = await request(
          `/validation-findings/${created.findings[0].id}/${action}`,
          'POST',
        );
        expect(result.status).toBe(201);
        expect(result.body).toMatchObject({ status, reviewedBy: user.toString() });
        expect(result.body.reviewedAt).toBeDefined();
      }
      const audits = await connection.collection('audit_logs').find({}).toArray();
      expect(audits.map((a) => a.action)).toEqual(['FINDING_ACCEPTED', 'FINDING_REJECTED']);
      expect(audits.every((a) => a.organizationId.toString() === org.toString())).toBe(true);
    },
  );

  it.each(['SCREEN.bms', 'SCREEN', 'test.bms'])(
    'preserves legacy screen storage and identifier %s',
    async (screenId) => {
      await connection
        .collection('screens')
        .updateOne(
          { _id: screen },
          { $set: { projectId: project.toString() }, $unset: { organizationId: '' } },
        );
      await connection
        .collection('conversion_jobs')
        .updateOne({ _id: job }, { $set: { screenId } });
      const result = await request(getPath(project.toString(), screenId));
      expect(result.status).toBe(200);
      // Historical findings without organizationId are owned through the checked run.
      const findingId = new Types.ObjectId(result.body.findings[0].id);
      await connection
        .collection('validation_findings')
        .updateOne({ _id: findingId }, { $unset: { organizationId: '' } });
      expect((await request(`/validation-findings/${findingId}/accept`, 'POST')).status).toBe(201);
    },
  );

  it.each(['accept', 'reject'])(
    'denies %s of AI findings for both same-tenant and cross-tenant callers',
    async (action) => {
      for (const tenant of [org, otherOrg]) {
        const { finding } = await ai(tenant);
        const before = await snapshot();
        const denied = await request(`/validation-findings/${finding.id}/${action}`, 'POST');
        const missing = await request(
          `/validation-findings/${new Types.ObjectId()}/${action}`,
          'POST',
        );
        expect(denied).toEqual(missing);
        expect(denied.status).toBe(404);
        expect(await snapshot()).toEqual(before);
      }
    },
  );

  it('denies cross-tenant GET without revealing an AI run or creating records', async () => {
    await ai(otherOrg);
    await connection
      .collection('projects')
      .updateOne(
        { _id: project },
        { $set: { organizationId: otherOrg, conversionType: ConversionType.COBOL_TO_JAVA } },
      );
    const before = await snapshot();
    const denied = await request(getPath());
    const missing = await request(getPath(new Types.ObjectId().toString()));
    expect(denied).toEqual(missing);
    expect(denied.status).toBe(404);
    expect(await snapshot()).toEqual(before);
  });

  it('denies same-tenant COBOL GET even with an existing AI run', async () => {
    await ai();
    await connection
      .collection('conversion_jobs')
      .updateOne({ _id: job }, { $set: { conversionType: ConversionType.COBOL_TO_JAVA } });
    const before = await snapshot();
    expect((await request(getPath())).status).toBe(404);
    expect(await snapshot()).toEqual(before);
  });

  it.each([
    ['projects', 'organizationId', otherOrg],
    ['projects', 'conversionType', ConversionType.COBOL_TO_JAVA],
    ['screens', 'projectId', new Types.ObjectId()],
    ['screens', 'organizationId', otherOrg],
    ['screens', 'sourceType', 'COBOL'],
    ['conversion_jobs', 'projectId', new Types.ObjectId()],
    ['conversion_jobs', 'organizationId', otherOrg],
    ['conversion_jobs', 'screenId', new Types.ObjectId().toString()],
  ])('denies GET and review for wrong %s.%s ownership/type', async (collection, field, value) => {
    const created = await legacy();
    await connection
      .collection(collection as string)
      .updateMany({}, { $set: { [field as string]: value } });
    const before = await snapshot();
    expect((await request(getPath())).status).toBe(404);
    for (const action of ['accept', 'reject'])
      expect(
        (await request(`/validation-findings/${created.findings[0].id}/${action}`, 'POST')).status,
      ).toBe(404);
    expect(await snapshot()).toEqual(before);
  });

  it.each(['organizationId', 'projectId', 'conversionJobId', 'screenId', 'validationRunId'])(
    'denies finding %s mismatch without mutation or audit',
    async (field) => {
      const created = await legacy();
      const id = new Types.ObjectId(created.findings[0].id);
      await connection
        .collection('validation_findings')
        .updateOne(
          { _id: id },
          { $set: { [field]: field === 'screenId' ? 'wrong-screen' : new Types.ObjectId() } },
        );
      const before = await snapshot();
      for (const action of ['accept', 'reject'])
        expect((await request(`/validation-findings/${id}/${action}`, 'POST')).status).toBe(404);
      expect(await snapshot()).toEqual(before);
    },
  );

  it.each([
    'organizationId',
    'projectId',
    'conversionJobId',
    'screenId',
    'aiValidationEnabled',
    'ruleValidationEnabled',
    'provider',
  ])('denies incompatible parent run %s', async (field) => {
    const created = await legacy();
    const value =
      field === 'screenId' || field === 'provider'
        ? 'wrong'
        : field === 'aiValidationEnabled'
          ? true
          : field === 'ruleValidationEnabled'
            ? false
            : new Types.ObjectId();
    await connection
      .collection('validation_runs')
      .updateOne({ _id: new Types.ObjectId(created.run.id) }, { $set: { [field]: value } });
    const before = await snapshot();
    expect(
      (await request(`/validation-findings/${created.findings[0].id}/accept`, 'POST')).status,
    ).toBe(404);
    expect(await snapshot()).toEqual(before);
  });

  it('filters mixed-collection AI runs and findings from BMS reads', async () => {
    const aiRecords = await ai();
    const created = await legacy();
    expect(created.run.id).not.toBe(aiRecords.run.id);
    await connection
      .collection('validation_findings')
      .updateOne(
        { _id: aiRecords.finding._id },
        { $set: { validationRunId: new Types.ObjectId(created.run.id) } },
      );
    const read = await legacy();
    expect(read.findings.map((f) => f.id)).toEqual(created.findings.map((f) => f.id));
  });

  it('does not resolve a foreign screen ID through a same-named local screen', async () => {
    const foreignId = new Types.ObjectId();
    await connection
      .collection('screens')
      .updateOne({ _id: screen }, { $set: { name: foreignId.toString() } });
    await connection
      .collection('conversion_jobs')
      .updateOne({ _id: job }, { $set: { screenId: foreignId.toString() } });
    const before = await snapshot();
    expect((await request(getPath(project.toString(), foreignId.toString()))).status).toBe(404);
    expect(await snapshot()).toEqual(before);
  });

  it('does not append an audit event when a scoped update no longer matches', async () => {
    const created = await legacy();
    const repository = app.get<ValidationRepository>(VALIDATION_REPOSITORY);
    const update = jest.spyOn(repository, 'updateFindingStatus').mockResolvedValueOnce(null);
    try {
      const before = await snapshot();
      expect(
        (await request(`/validation-findings/${created.findings[0].id}/accept`, 'POST')).status,
      ).toBe(404);
      expect(await snapshot()).toEqual(before);
    } finally {
      update.mockRestore();
    }
  });

  it('preserves dedicated AI review role, note, transition and audit rules', async () => {
    const { run, finding } = await ai();
    const path = `/projects/${project}/validation-runs/${run.id}/findings/${finding.id}/review`;
    await connection
      .collection('organizations')
      .updateOne({ _id: org }, { $set: { 'members.0.role': 'VIEWER' } });
    const before = await snapshot();
    expect((await request(path, 'PATCH', { body: { status: 'NEEDS_CORRECTION' } })).status).toBe(
      403,
    );
    await connection
      .collection('organizations')
      .updateOne({ _id: org }, { $set: { 'members.0.role': 'MEMBER' } });
    expect((await request(path, 'PATCH', { body: { status: 'NOT_APPLICABLE' } })).status).toBe(400);
    expect(await snapshot()).toEqual(before);
    const result = await request(path, 'PATCH', {
      body: { status: 'NOT_APPLICABLE', reviewNote: 'Synthetic review note' },
    });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      status: 'NOT_APPLICABLE',
      reviewNote: 'Synthetic review note',
      reviewedBy: user.toString(),
    });
    expect(
      await connection
        .collection('audit_logs')
        .countDocuments({ action: 'VALIDATION_FINDING_REVIEWED' }),
    ).toBe(1);
  });

  it('keeps type/scope predicates in the atomic update, including unknown AI schema fields', async () => {
    const created = await legacy();
    const id = new Types.ObjectId(created.findings[0].id);
    const repository = app.get<ValidationRepository>(VALIDATION_REPOSITORY);
    const scope = {
      organizationId: org.toString(),
      projectId: project.toString(),
      conversionJobId: job.toString(),
      screenId: screen.toString(),
      validationRunId: created.run.id,
    };
    for (const changes of [
      { category: 'LOGIC_MISMATCH' },
      { source: 'AI' },
      { organizationId: otherOrg },
      { validationRunId: new Types.ObjectId() },
    ]) {
      const original = await connection.collection('validation_findings').findOne({ _id: id });
      await connection.collection('validation_findings').updateOne({ _id: id }, { $set: changes });
      const before = await snapshot();
      expect(
        await repository.updateFindingStatus(
          id.toString(),
          FindingStatus.CONFIRMED,
          scope,
          user.toString(),
        ),
      ).toBeNull();
      expect(await snapshot()).toEqual(before);
      await connection.collection('validation_findings').replaceOne({ _id: id }, original!);
    }
  });

  it.each(['accept', 'reject'])('denies viewer %s but preserves viewer reads', async (action) => {
    const created = await legacy();
    await connection
      .collection('organizations')
      .updateOne({ _id: org }, { $set: { 'members.0.role': 'VIEWER' } });
    expect((await request(getPath())).status).toBe(200);
    const before = await snapshot();
    expect(
      (await request(`/validation-findings/${created.findings[0].id}/${action}`, 'POST')).status,
    ).toBe(403);
    expect(await snapshot()).toEqual(before);
  });

  it('honors an explicit organization and never falls back or provisions access', async () => {
    const before = await snapshot();
    expect((await request(getPath(), 'GET', { org: otherOrg.toString() })).status).toBe(403);
    expect(
      (
        await request(getPath(), 'GET', {
          token: jwt.sign({ sub: new Types.ObjectId().toString() }, { secret }),
        })
      ).status,
    ).toBe(403);
    expect(await connection.collection('organizations').countDocuments()).toBe(2);
    expect(await snapshot()).toEqual(before);
  });

  it.each([null, 'invalid-token'])('requires valid authentication (%s)', async (token) => {
    const before = await snapshot();
    expect((await request(getPath(), 'GET', { token })).status).toBe(401);
    for (const action of ['accept', 'reject'])
      expect(
        (await request(`/validation-findings/${new Types.ObjectId()}/${action}`, 'POST', { token }))
          .status,
      ).toBe(401);
    expect(await snapshot()).toEqual(before);
  });

  it('rejects malformed IDs without casts, reads or audits', async () => {
    const before = await snapshot();
    for (const path of [
      getPath('invalid'),
      getPath(project.toString(), screen.toString(), 'invalid'),
    ])
      expect((await request(path)).status).toBe(404);
    for (const action of ['accept', 'reject'])
      expect((await request(`/validation-findings/invalid/${action}`, 'POST')).status).toBe(404);
    expect((await request(getPath(), 'GET', { org: 'invalid' })).status).toBe(404);
    expect(await snapshot()).toEqual(before);
  });

  it('preserves BMS reconvert and denies COBOL reconvert before mapping/job/audit writes', async () => {
    const path = `/projects/${project}/screens/${screen}/reconvert`;
    expect((await request(path, 'POST', { body: { mappings: [] } })).status).toBe(201);
    expect(queue.enqueue).toHaveBeenCalledTimes(1);
    await connection
      .collection('screens')
      .updateOne({ _id: screen }, { $set: { sourceType: 'COBOL' } });
    const before = await snapshot();
    const jobCount = await connection.collection('conversion_jobs').countDocuments();
    expect((await request(path, 'POST', { body: { mappings: [] } })).status).toBe(404);
    expect(await connection.collection('conversion_jobs').countDocuments()).toBe(jobCount);
    expect(queue.enqueue).toHaveBeenCalledTimes(1);
    expect(await snapshot()).toEqual(before);
  });
});
