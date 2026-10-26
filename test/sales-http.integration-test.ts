/** Owned full-AppModule business workflow tests. No external engines, CRM imports or real money. */
import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { AddressInfo } from 'node:net';
import * as path from 'node:path';
import * as bcrypt from 'bcrypt';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, createConnection, Types } from 'mongoose';
import { ApiExceptionFilter } from '../src/shared/errors/api-exception.filter';
import { MongoAuditRepository } from '../src/modules/audit/infrastructure/mongo-audit.repository';
import { Lead } from '../src/modules/crm/infrastructure/lead.schema';
import { LeadRecord } from '../src/modules/crm/domain/lead.types';
import { Payment } from '../src/modules/billing/infrastructure/payment.schema';
import { PaymentStatus, PlanTier } from '../src/modules/billing/domain/billing.types';
import { MongoSalesRevenueRepository } from '../src/modules/billing/infrastructure/persistence/mongo-sales-revenue.repository';
import { MongoSalesPerformanceSource } from '../src/modules/crm/infrastructure/mongo-sales-performance.source';

jest.setTimeout(60000);
const owned = process.env.ALSM_SALES_HTTP_TEST === 'owned-local-only' ? describe : describe.skip;
const id = () => new Types.ObjectId().toHexString();
function verifyOwnedServices() {
  for (const [name, owner, inside, outside] of [
    ['alsm-priorities-20261017-mongo-rs', 'priorities-20261017', '27017/tcp', '27127'],
    ['alsm-emergency-20261017-browser-redis', 'emergency-20261017', '6379/tcp', '6398'],
  ]) {
    const [info] = JSON.parse(
      execFileSync('docker', ['inspect', name], { encoding: 'utf8', windowsHide: true }),
    ) as {
      Config: { Labels: Record<string, string> };
      State: { Running: boolean };
      NetworkSettings: { Ports: Record<string, { HostIp: string; HostPort: string }[]> };
    }[];
    expect(info.Config.Labels['alsm.owner']).toBe(owner);
    expect(info.State.Running).toBe(true);
    expect(info.NetworkSettings.Ports[inside]).toEqual([
      { HostIp: '127.0.0.1', HostPort: outside },
    ]);
  }
}
owned('Sales actual HTTP, Mongo transactions and normal login', () => {
  const runId = randomUUID().replaceAll('-', ''),
    database = `alsm_sales_http_${runId}`;
  const uri = `mongodb://127.0.0.1:27127/${database}?replicaSet=alsmPriorities&directConnection=true`;
  const owner = id(),
    manager = id(),
    sellerA = id(),
    sellerB = id(),
    customer = id(),
    foreign = id(),
    organization = id(),
    foreignOrganization = id();
  const tokens = new Map<string, string>(),
    originalEnvironment = { ...process.env };
  let app: INestApplication, connection: Connection, base: string;
  async function api(
    method: string,
    route: string,
    body?: unknown,
    actor = owner,
    tenant = organization,
  ) {
    const response = await fetch(base + route, {
      method,
      headers: {
        Authorization: `Bearer ${tokens.get(actor)}`,
        'Content-Type': 'application/json',
        'x-organization-id': tenant,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }
  async function newTeam() {
    const response = await api('POST', '/teams', {
      creationId: id(),
      name: `TEST FIXTURE Sales ${id()}`,
      kind: 'SALES',
      memberIds: [sellerA, sellerB],
      managerIds: [manager, owner],
      projectAssignments: [],
      expectedRevision: 0,
    });
    expect(response.status).toBe(201);
    return String(response.body.id);
  }
  function leadInput(teamId: string, salespersonId = sellerA) {
    return {
      leadId: id(),
      assignmentId: id(),
      teamId,
      salespersonId,
      title: 'TEST FIXTURE sourced inquiry',
      sourceReference: `TEST-FIXTURE-${id()}`,
      contactEmail: 'fixture@example.invalid',
    };
  }
  async function createLead(teamId: string, salespersonId = sellerA) {
    const input = leadInput(teamId, salespersonId),
      response = await api('POST', '/sales/leads', input);
    expect(response.status).toBe(201);
    return response.body as unknown as LeadRecord;
  }
  async function conversion(lead: LeadRecord) {
    return api('POST', `/sales/leads/${lead.id}/customer-conversions`, {
      conversionId: id(),
      customerUserId: customer,
      reference: `TEST-CUSTOMER-CONFIRMATION-${id()}`,
      expectedRevision: lead.revision,
    });
  }
  async function payment(
    status = PaymentStatus.COMPLETED,
    amountVnd = 10000,
    paidAt = new Date(Date.now() - 1000),
    tenant = organization,
  ) {
    const doc = await connection.model<Payment>(Payment.name).create({
      userId: new Types.ObjectId(customer),
      organizationId: new Types.ObjectId(tenant),
      planTier: PlanTier.STARTER,
      amountVnd,
      status,
      paidAt,
      cassoTransactionId: `TEST-TRANSACTION-${id()}`,
      referenceCode: `TEST-FIXTURE-${id()}`,
      bankName: 'TEST FIXTURE, not a bank',
      accountNumber: 'TEST-ONLY',
      accountName: 'TEST FIXTURE',
      expiresAt: new Date(Date.now() + 60000),
    });
    return doc;
  }
  async function report(teamId: string, days = 7) {
    const response = await api(
      'GET',
      `/teams/${teamId}/performance?days=${days}`,
      undefined,
      manager,
    );
    expect(response.status).toBe(200);
    return response.body as unknown as {
      metrics: Record<string, { value?: number; available: boolean; code?: string }>;
      members: {
        userId: string;
        currentMember: boolean;
        metrics: Record<string, { value?: number }>;
      }[];
    };
  }
  beforeAll(async () => {
    verifyOwnedServices();
    const preflight = await createConnection(uri).asPromise();
    expect((await preflight.db!.listCollections().toArray()).length).toBe(0);
    await preflight.collection('_sales_test_owner').insertOne({ runId });
    await preflight.close();
    Object.assign(process.env, {
      NODE_ENV: 'test',
      MONGODB_URI: uri,
      REDIS_HOST: '127.0.0.1',
      REDIS_PORT: '6398',
      REDIS_PASSWORD: '',
      JWT_ACCESS_SECRET: randomBytes(48).toString('hex'),
      JWT_REFRESH_SECRET: randomBytes(48).toString('hex'),
      JWT_ACCESS_EXPIRES_IN: '15m',
      JWT_REFRESH_EXPIRES_IN: '1h',
      MFA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      CORS_ORIGINS: 'http://127.0.0.1:3012',
      STORAGE_ROOT: path.resolve('coverage/updated-priorities/storage', runId),
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
    const { AppModule } = await import('../src/app.module');
    app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.listen(0, '127.0.0.1');
    connection = app.get(getConnectionToken());
    expect(connection.name).toBe(database);
    expect(connection.host).toBe('127.0.0.1');
    expect(connection.port).toBe(27127);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
    const password = randomBytes(24).toString('base64url'),
      passwordHash = await bcrypt.hash(password, 10);
    await connection.collection('users').insertMany(
      [owner, manager, sellerA, sellerB, customer, foreign].map((userId) => ({
        _id: new Types.ObjectId(userId),
        email: `${userId}@example.invalid`,
        fullName: `TEST FIXTURE ${userId}`,
        passwordHash,
        isActive: true,
        isEmailVerified: true,
        isPlatformAdmin: false,
        mustChangePassword: false,
        mfa: { enabled: false },
      })),
    );
    await connection
      .collection('user_roles')
      .insertMany([owner, foreign].map((userId) => ({ userId, roleId: 'TEAM_LEAD' })));
    await connection.collection('organizations').insertMany([
      {
        _id: new Types.ObjectId(organization),
        name: 'TEST FIXTURE Sales Org',
        type: 'INTERNAL',
        members: [owner, manager, sellerA, sellerB, customer].map((userId) => ({
          userId: new Types.ObjectId(userId),
          role: userId === owner ? 'OWNER' : 'MEMBER',
        })),
      },
      {
        _id: new Types.ObjectId(foreignOrganization),
        name: 'TEST FIXTURE Foreign Org',
        type: 'INTERNAL',
        members: [{ userId: new Types.ObjectId(foreign), role: 'OWNER' }],
      },
    ]);
    for (const userId of [owner, manager, sellerA, foreign]) {
      const response = await fetch(base + '/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: `${userId}@example.invalid`, password }),
      });
      expect(response.status).toBe(200);
      const result = (await response.json()) as { accessToken: string };
      tokens.set(userId, result.accessToken);
    }
    await connection.model(Lead.name).init();
    await connection.model(Payment.name).init();
  });
  afterAll(async () => {
    verifyOwnedServices();
    const cleanup =
      connection?.readyState === 1 ? connection : await createConnection(uri).asPromise();
    try {
      expect(cleanup.name).toBe(database);
      expect(await cleanup.collection('_sales_test_owner').findOne({ runId })).toBeTruthy();
      await cleanup.dropDatabase();
    } finally {
      if (cleanup !== connection) await cleanup.close();
      await app?.close();
      process.env = originalEnvironment;
    }
  });
  it('records explicit sourced leads through the authorized API and rejects forged dates, history or amounts', async () => {
    const team = await newTeam(),
      input = leadInput(team);
    for (const extra of [
      { assignedAt: new Date().toISOString() },
      { assignments: [] },
      { amountVnd: 999 },
      { actorUserId: foreign },
    ])
      expect((await api('POST', '/sales/leads', { ...input, ...extra })).status).toBe(400);
    const created = await api('POST', '/sales/leads', input);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      status: 'ASSIGNED',
      revision: 1,
      assignments: [
        { id: input.assignmentId, salespersonId: sellerA, teamId: team, actorUserId: owner },
      ],
    });
    expect(
      await connection
        .collection('leads')
        .countDocuments({ _id: new Types.ObjectId(input.leadId) }),
    ).toBe(1);
    expect((await api('GET', `/sales/leads/${input.leadId}`)).status).toBe(200);
  });
  it('deduplicates creation IDs and source references, including concurrent submissions', async () => {
    const team = await newTeam(),
      input = leadInput(team);
    const race = await Promise.all([
      api('POST', '/sales/leads', input),
      api('POST', '/sales/leads', input),
    ]);
    expect(race.map((result) => result.status)).toEqual([201, 201]);
    expect(race.map((result) => result.body.id)).toEqual([input.leadId, input.leadId]);
    expect(
      (await api('POST', '/sales/leads', { ...input, title: 'Different intent' })).status,
    ).toBe(409);
    expect((await api('POST', '/sales/leads', { ...input, leadId: id() })).status).toBe(409);
    expect(
      await connection.collection('leads').countDocuments({
        organizationId: new Types.ObjectId(organization),
        sourceReference: input.sourceReference,
      }),
    ).toBe(1);
  });
  it('retains immutable reassignment history, CAS conflicts and the original conversion assignee after handover', async () => {
    const team = await newTeam(),
      lead = await createLead(team);
    const reassignment = {
      assignmentId: id(),
      teamId: team,
      salespersonId: sellerB,
      expectedRevision: 1,
    };
    const assigned = await api('POST', `/sales/leads/${lead.id}/assignments`, reassignment);
    expect(assigned.status).toBe(201);
    const converted = await conversion(assigned.body as unknown as LeadRecord);
    expect(converted.status).toBe(201);
    expect(converted.body).toMatchObject({
      status: 'CONVERTED',
      conversion: {
        salespersonId: sellerB,
        assignmentId: reassignment.assignmentId,
        customerUserId: customer,
      },
    });
    const handover = await api('POST', `/sales/leads/${lead.id}/assignments`, {
      assignmentId: id(),
      teamId: team,
      salespersonId: sellerA,
      expectedRevision: 3,
    });
    expect(handover.status).toBe(201);
    const replay = await api('POST', `/sales/leads/${lead.id}/assignments`, reassignment);
    expect(replay.body).toMatchObject({
      revision: 4,
      replayed: true,
      conversion: { salespersonId: sellerB },
    });
    const history = replay.body.assignments as { id: string; salespersonId: string }[];
    expect(history.map((item) => item.salespersonId)).toEqual([sellerA, sellerB, sellerA]);
    expect(history[0].id).toBe(lead.assignments[0].id);
    expect(
      (
        await api('POST', `/sales/leads/${lead.id}/assignments`, {
          assignmentId: id(),
          teamId: team,
          salespersonId: sellerB,
          expectedRevision: 1,
        })
      ).status,
    ).toBe(409);
    const result = await report(team);
    expect(result.metrics).toMatchObject({
      leadCount: { value: 1 },
      conversionRate: { value: 100 },
    });
    expect(result.members.find((member) => member.userId === sellerA)?.metrics).toMatchObject({
      leadCount: { value: 1 },
      conversionRate: { value: 0 },
    });
    expect(result.members.find((member) => member.userId === sellerB)?.metrics).toMatchObject({
      leadCount: { value: 1 },
      conversionRate: { value: 100 },
    });
  });
  it('serializes competing reassignment and conversion operations against the exact revision', async () => {
    const team = await newTeam(),
      lead = await createLead(team);
    const results = await Promise.all([
      api('POST', `/sales/leads/${lead.id}/assignments`, {
        assignmentId: id(),
        teamId: team,
        salespersonId: sellerB,
        expectedRevision: 1,
      }),
      conversion(lead),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    const stored = (await api('GET', `/sales/leads/${lead.id}`)).body as unknown as LeadRecord;
    expect(stored.revision).toBe(2);
    if (stored.conversion) {
      expect(stored.conversion.salespersonId).toBe(sellerA);
      expect(stored.assignments).toHaveLength(1);
    } else {
      expect(stored.assignments).toHaveLength(2);
      expect(stored.assignments[1].salespersonId).toBe(sellerB);
    }
  });
  it('rejects conflicting concurrent assignments and retains exactly one active assignee', async () => {
    const team = await newTeam(),
      otherTeam = await newTeam(),
      lead = await createLead(team);
    const results = await Promise.all(
      [team, otherTeam].map((teamId) =>
        api('POST', `/sales/leads/${lead.id}/assignments`, {
          assignmentId: id(),
          teamId,
          salespersonId: sellerB,
          expectedRevision: 1,
        }),
      ),
    );
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    const stored = (await api('GET', `/sales/leads/${lead.id}`)).body as unknown as LeadRecord;
    expect(stored.assignments).toHaveLength(2);
    expect(stored.activeAssignment.id).toBe(stored.assignments[1].id);
    expect(stored.activeAssignment.salespersonId).toBe(sellerB);
  });
  it('requires an actual in-organization customer account and business confirmation reference', async () => {
    const team = await newTeam(),
      lead = await createLead(team);
    const input = {
      conversionId: id(),
      expectedRevision: 1,
      customerUserId: foreign,
      reference: 'TEST-CONFIRMATION',
    };
    expect((await api('POST', `/sales/leads/${lead.id}/customer-conversions`, input)).status).toBe(
      400,
    );
    expect(
      (
        await api('POST', `/sales/leads/${lead.id}/customer-conversions`, {
          ...input,
          customerUserId: customer,
          reference: '',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await api('POST', `/sales/leads/${lead.id}/customer-conversions`, {
          ...input,
          customerUserId: customer,
          convertedAt: new Date().toISOString(),
        })
      ).status,
    ).toBe(400);
    expect((await api('GET', `/sales/leads/${lead.id}`)).body).toMatchObject({
      status: 'ASSIGNED',
      revision: 1,
    });
  });
  it('uses the recorded responsible salesperson of a completed payment and never sums invoice estimates', async () => {
    const team = await newTeam(),
      lead = await createLead(team);
    expect((await conversion(lead)).status).toBe(201);
    const confirmed = await payment(),
      input = {
        paymentId: String(confirmed._id),
        teamId: team,
        salespersonId: sellerB,
        evidenceReference: `TEST-RESPONSIBILITY-${id()}`,
      };
    expect(
      (await api('POST', '/sales/revenue-attributions', { ...input, amountVnd: 99999 })).status,
    ).toBe(400);
    const attributed = await api('POST', '/sales/revenue-attributions', input);
    expect(attributed.status).toBe(201);
    expect((await api('POST', '/sales/revenue-attributions', input)).status).toBe(201);
    expect(
      (await api('POST', '/sales/revenue-attributions', { ...input, salespersonId: sellerA }))
        .status,
    ).toBe(409);
    const result = await report(team);
    expect(result.metrics.revenueGenerated.value).toBe(10000);
    expect(
      result.members.find((member) => member.userId === sellerA)?.metrics.revenueGenerated.value,
    ).toBe(0);
    expect(
      result.members.find((member) => member.userId === sellerB)?.metrics.revenueGenerated.value,
    ).toBe(10000);
    const pending = await payment(PaymentStatus.PENDING),
      outside = await payment(
        PaymentStatus.COMPLETED,
        500,
        new Date(Date.now() - 1000),
        foreignOrganization,
      );
    expect(
      (
        await api('POST', '/sales/revenue-attributions', {
          ...input,
          paymentId: String(pending._id),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await api('POST', '/sales/revenue-attributions', {
          ...input,
          paymentId: String(outside._id),
        })
      ).status,
    ).toBe(400);
  });
  it('uses confirmation dates for revenue periods and excludes payments that are no longer confirmed', async () => {
    const team = await newTeam(),
      confirmed = await payment(
        PaymentStatus.COMPLETED,
        7000,
        new Date(Date.now() - 10 * 86400000),
      );
    expect(
      (
        await api('POST', '/sales/revenue-attributions', {
          paymentId: String(confirmed._id),
          teamId: team,
          salespersonId: sellerA,
          evidenceReference: `TEST-RESPONSIBILITY-${id()}`,
        })
      ).status,
    ).toBe(201);
    expect((await report(team, 7)).metrics.revenueGenerated.value).toBe(0);
    expect((await report(team, 30)).metrics.revenueGenerated.value).toBe(7000);
    await connection
      .model<Payment>(Payment.name)
      .updateOne({ _id: confirmed._id }, { $set: { status: PaymentStatus.EXPIRED } });
    expect((await report(team, 30)).metrics.revenueGenerated.value).toBe(0);
  });
  it('does not grant duplicate sales credit during competing confirmed-payment attributions', async () => {
    const team = await newTeam(),
      confirmed = await payment();
    const results = await Promise.all(
      [sellerA, sellerB].map((salespersonId) =>
        api('POST', '/sales/revenue-attributions', {
          paymentId: String(confirmed._id),
          teamId: team,
          salespersonId,
          evidenceReference: `TEST-RESPONSIBILITY-${salespersonId}`,
        }),
      ),
    );
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect((await report(team)).metrics.revenueGenerated.value).toBe(10000);
  });
  it('rejects duplicate bank confirmation identities instead of silently counting the same revenue twice', async () => {
    const team = await newTeam(),
      first = await payment();
    expect(
      (
        await api('POST', '/sales/revenue-attributions', {
          paymentId: String(first._id),
          teamId: team,
          salespersonId: sellerA,
          evidenceReference: 'TEST-RESPONSIBILITY-FIRST',
        })
      ).status,
    ).toBe(201);
    const duplicate = await payment();
    await connection
      .model<Payment>(Payment.name)
      .updateOne(
        { _id: duplicate._id },
        { $set: { cassoTransactionId: first.cassoTransactionId } },
      );
    expect(
      (
        await api('POST', '/sales/revenue-attributions', {
          paymentId: String(duplicate._id),
          teamId: team,
          salespersonId: sellerB,
          evidenceReference: 'TEST-RESPONSIBILITY-DUPLICATE',
        })
      ).status,
    ).toBe(409);
    const response = await api('GET', `/teams/${team}/performance?days=7`, undefined, manager);
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('DUPLICATE_CONFIRMED_TRANSACTION');
  });
  it('returns explicit zero-denominator results for an empty recorded cohort', async () => {
    const result = await report(await newTeam());
    expect(result.metrics).toMatchObject({
      leadCount: { available: true, value: 0 },
      conversionRate: { available: false, code: 'NO_ASSIGNED_LEADS' },
      revenueGenerated: { available: true, value: 0 },
    });
  });
  it('rolls back sourced lead, history, conversion and payment attribution when their audit fails', async () => {
    const team = await newTeam(),
      lead = await createLead(team),
      confirmed = await payment();
    const real = MongoAuditRepository.prototype.append;
    const failing = jest
      .spyOn(MongoAuditRepository.prototype, 'append')
      .mockImplementation(async function (this: MongoAuditRepository, event) {
        if (
          [
            'LEAD_CREATED',
            'LEAD_REASSIGNED',
            'LEAD_CONVERTED_TO_CUSTOMER',
            'CONFIRMED_PAYMENT_SALESPERSON_RECORDED',
          ].includes(event.action)
        )
          throw new Error('TEST audit outage');
        return real.call(this, event);
      });
    try {
      const input = leadInput(team);
      expect((await api('POST', '/sales/leads', input)).status).toBe(503);
      expect(
        await connection
          .collection('leads')
          .countDocuments({ _id: new Types.ObjectId(input.leadId) }),
      ).toBe(0);
      expect(
        (
          await api('POST', `/sales/leads/${lead.id}/assignments`, {
            assignmentId: id(),
            teamId: team,
            salespersonId: sellerB,
            expectedRevision: 1,
          })
        ).status,
      ).toBe(503);
      expect((await conversion(lead)).status).toBe(503);
      expect((await api('GET', `/sales/leads/${lead.id}`)).body).toMatchObject({
        revision: 1,
        status: 'ASSIGNED',
        assignments: [{ salespersonId: sellerA }],
      });
      expect(
        (
          await api('POST', '/sales/revenue-attributions', {
            paymentId: String(confirmed._id),
            teamId: team,
            salespersonId: sellerB,
            evidenceReference: 'TEST-RESPONSIBILITY',
          })
        ).status,
      ).toBe(503);
      const stored = await connection.model<Payment>(Payment.name).findById(confirmed._id);
      expect(stored?.salesResponsibility).toBeUndefined();
      expect(stored?.amountVnd).toBe(10000);
      expect(stored?.status).toBe(PaymentStatus.COMPLETED);
    } finally {
      failing.mockRestore();
    }
  });
  it('enforces ordinary-member, explicit manager, organization and team isolation', async () => {
    const team = await newTeam(),
      lead = await createLead(team),
      input = leadInput(team);
    expect((await api('POST', '/sales/leads', input, manager)).status).toBe(403);
    expect((await api('POST', '/sales/leads', input, sellerA)).status).toBe(403);
    expect((await api('GET', `/sales/leads/${lead.id}`, undefined, manager)).status).toBe(403);
    expect(
      (await api('GET', `/sales/leads/${lead.id}`, undefined, foreign, foreignOrganization)).status,
    ).toBe(404);
    expect((await api('GET', `/sales/leads/${lead.id}`, undefined, foreign)).status).toBe(403);
    expect(
      (
        await api('POST', `/sales/leads/${lead.id}/assignments`, {
          assignmentId: id(),
          teamId: team,
          salespersonId: foreign,
          expectedRevision: 1,
        })
      ).status,
    ).toBe(400);
    expect((await api('GET', `/teams/${team}/performance?days=7`, undefined, sellerA)).status).toBe(
      404,
    );
    expect((await api('GET', `/teams/${team}/performance?days=7`, undefined, foreign)).status).toBe(
      403,
    );
    const before = await api('GET', `/teams/${team}/administration`);
    expect(
      (
        await api('PUT', `/teams/${team}`, {
          name: before.body.name,
          kind: 'SALES',
          memberIds: [sellerA, sellerB],
          managerIds: [owner],
          projectAssignments: [],
          expectedRevision: before.body.revision,
        })
      ).status,
    ).toBe(200);
    expect((await api('GET', `/teams/${team}/performance?days=7`, undefined, manager)).status).toBe(
      404,
    );
  });
  it('honors half-open assignment boundaries and excludes older assignment cohorts despite recent conversions', async () => {
    const team = await newTeam(),
      start = new Date('2026-10-01T00:00:00Z'),
      end = new Date('2026-10-08T00:00:00Z');
    const entries: LeadRecord[] = [];
    for (const assignedAt of [
      start,
      new Date(start.getTime() - 1),
      new Date(end.getTime() - 1),
      end,
    ]) {
      const lead = await createLead(team);
      expect((await conversion(lead)).status).toBe(201);
      entries.push(lead);
      // Boundary placement of owned test fixtures only, never a migration/backfill.
      await connection.model<Lead>(Lead.name).updateOne(
        { _id: new Types.ObjectId(lead.id) },
        {
          $set: {
            'assignments.0.startedAt': assignedAt,
            'conversion.convertedAt': new Date(end.getTime() - 1),
          },
        },
      );
    }
    const source = new MongoSalesPerformanceSource(
      connection.model<Lead>(Lead.name),
      new MongoSalesRevenueRepository(connection.model<Payment>(Payment.name)),
    );
    const records = await source.read(organization, team, start, end);
    expect(records.leads.map((lead) => lead.leadId).sort()).toEqual(
      [entries[0].id, entries[2].id].sort(),
    );
    expect(records.leads.every((lead) => lead.convertedMemberId === sellerA)).toBe(true);
    expect((await source.read(foreignOrganization, team, start, end)).leads).toEqual([]);
  });
  it('retains recorded conversion credit when a salesperson leaves the current team roster', async () => {
    const team = await newTeam(),
      lead = await createLead(team);
    expect((await conversion(lead)).status).toBe(201);
    const before = await api('GET', `/teams/${team}/administration`);
    expect(
      (
        await api('PUT', `/teams/${team}`, {
          name: before.body.name,
          kind: 'SALES',
          memberIds: [sellerB],
          managerIds: [owner, manager],
          projectAssignments: [],
          expectedRevision: before.body.revision,
        })
      ).status,
    ).toBe(200);
    const result = await report(team),
      historical = result.members.find((member) => member.userId === sellerA);
    expect(historical).toMatchObject({
      currentMember: false,
      metrics: { leadCount: { value: 1 }, conversionRate: { value: 100 } },
    });
  });
  it('fails closed before recording a duplicate sourced lead when its uniqueness index is absent', async () => {
    verifyOwnedServices();
    expect(connection.name).toBe(database);
    expect(await connection.collection('_sales_test_owner').findOne({ runId })).toBeTruthy();
    const team = await newTeam(),
      input = leadInput(team),
      model = connection.model<Lead>(Lead.name);
    await model.collection.dropIndex('one_lead_per_source_reference');
    try {
      const response = await api('POST', '/sales/leads', input);
      expect(response.status).toBe(503);
      expect(response.body.code).toBe('LEAD_SOURCE_INDEX_REQUIRED');
      expect(await model.countDocuments({ _id: new Types.ObjectId(input.leadId) })).toBe(0);
    } finally {
      await model.createIndexes();
    }
  });
});
