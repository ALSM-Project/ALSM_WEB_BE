import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Connection, createConnection, Types } from 'mongoose';
import { MongoTransactionRunner } from '../src/shared/database/mongo-transaction-runner';
import { Lead, LeadSchema } from '../src/modules/crm/infrastructure/lead.schema';
import { MongoLeadRepository } from '../src/modules/crm/infrastructure/mongo-lead.repository';
import { AuditLog, AuditLogSchema } from '../src/modules/audit/infrastructure/audit-log.schema';
import { MongoAuditRepository } from '../src/modules/audit/infrastructure/mongo-audit.repository';
const owned = process.env.ALSM_SALES_HTTP_TEST === 'owned-local-only' ? describe : describe.skip;
owned('Sales persistence on the owned replica set', () => {
  const runId = randomUUID().replaceAll('-', ''),
    database = `alsm_sales_records_${runId}`;
  const id = () => new Types.ObjectId().toHexString();
  const organizationId = id(),
    actorUserId = id(),
    teamId = id(),
    salespersonId = id();
  let connection: Connection,
    leads: MongoLeadRepository,
    audits: MongoAuditRepository,
    transactions: MongoTransactionRunner;
  function verify() {
    const [info] = JSON.parse(
      execFileSync('docker', ['inspect', 'alsm-priorities-20261017-mongo-rs'], {
        encoding: 'utf8',
        windowsHide: true,
      }),
    );
    expect(info.Config.Labels['alsm.owner']).toBe('priorities-20261017');
    expect(info.NetworkSettings.Ports['27017/tcp']).toEqual([
      { HostIp: '127.0.0.1', HostPort: '27127' },
    ]);
  }
  beforeAll(async () => {
    verify();
    connection = await createConnection(
      `mongodb://127.0.0.1:27127/${database}?replicaSet=alsmPriorities&directConnection=true`,
    ).asPromise();
    expect((await connection.db!.listCollections().toArray()).length).toBe(0);
    await connection.collection('_sales_records_owner').insertOne({ runId });
    const model = connection.model(Lead.name, LeadSchema);
    await model.init();
    const auditModel = connection.model(AuditLog.name, AuditLogSchema);
    await auditModel.init();
    leads = new MongoLeadRepository(model);
    audits = new MongoAuditRepository(auditModel);
    transactions = new MongoTransactionRunner(connection);
  });
  afterAll(async () => {
    if (!connection) return;
    verify();
    expect(connection.name).toBe(database);
    expect(await connection.collection('_sales_records_owner').findOne({ runId })).toBeTruthy();
    await connection.dropDatabase();
    await connection.close();
  });
  it('retains one active assignment and immutable history while rejecting stale concurrent revisions and foreign reads', async () => {
    const leadId = id(),
      assignment = {
        id: id(),
        teamId,
        salespersonId,
        startedAt: new Date(),
        actorUserId,
        expectedRevision: 0,
      };
    const create = {
      leadId,
      organizationId,
      actorUserId,
      title: 'TEST FIXTURE only',
      sourceReference: `TEST-${id()}`,
      assignment,
    };
    const first = await transactions.run(
      (session) => leads.inTransaction(session, connection).create(create),
      leadId,
    );
    expect(first.activeAssignment.id).toBe(assignment.id);
    const next = { ...assignment, id: id(), salespersonId: id(), expectedRevision: 1 };
    const updated = await transactions.run(
      (session) => leads.inTransaction(session, connection).assign(leadId, organizationId, next),
      leadId,
    );
    expect(updated?.assignments.map((item) => item.id)).toEqual([assignment.id, next.id]);
    expect(updated?.activeAssignment.id).toBe(next.id);
    expect(
      await transactions.run(
        (session) =>
          leads
            .inTransaction(session, connection)
            .assign(leadId, organizationId, { ...next, id: id() }),
        leadId,
      ),
    ).toBeNull();
    expect(await leads.findById(leadId, id())).toBeNull();
    await expect(leads.assign(leadId, organizationId, next)).rejects.toThrow('audited atomic');
  });
  it('does not retain a lead or audit after the shared transaction aborts', async () => {
    const leadId = id();
    await expect(
      transactions.run(async (session) => {
        await leads
          .inTransaction(session, connection)
          .create({
            leadId,
            organizationId,
            actorUserId,
            title: 'TEST FIXTURE rollback',
            sourceReference: `TEST-${id()}`,
            assignment: {
              id: id(),
              teamId,
              salespersonId,
              startedAt: new Date(),
              actorUserId,
              expectedRevision: 0,
            },
          });
        await audits
          .inTransaction(session, connection)
          .append({
            actorUserId,
            organizationId,
            action: 'TEST_SALES_ATOMICITY',
            resourceType: 'lead',
            resourceId: leadId,
          });
        throw new Error('TEST failure after both writes');
      }, leadId),
    ).rejects.toMatchObject({ response: { code: 'ATOMIC_MUTATION_ABORTED' } });
    expect(await leads.findById(leadId, organizationId)).toBeNull();
    expect(await connection.collection('audit_logs').countDocuments({ resourceId: leadId })).toBe(
      0,
    );
  });
});
