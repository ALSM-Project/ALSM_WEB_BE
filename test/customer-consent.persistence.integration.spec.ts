import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Connection, createConnection, Model, Types, mongo } from 'mongoose';
import { MongoAuditRepository } from '../src/modules/audit/infrastructure/mongo-audit.repository';
import { AuditLog, AuditLogSchema } from '../src/modules/audit/infrastructure/audit-log.schema';
import { CustomerConsentEntity } from '../src/modules/support/domain/customer-consent.entity';
import { writeCustomerConsent } from '../src/modules/support/application/customer-consent-write';
import { ticketConsentCompatibility } from '../src/modules/support/application/customer-consent-context.service';
import { MongoCustomerConsentRepository } from '../src/modules/support/infrastructure/mongo-customer-consent.repository';
import {
  CUSTOMER_CONSENT_MODEL,
  CUSTOMER_CONSENT_SOURCE_INDEX,
  CUSTOMER_CONSENT_SOURCE_INDEX_NAME,
  CustomerConsentSchema,
  CustomerConsentSnapshot,
} from '../src/modules/support/infrastructure/customer-consent.schema';
import { consentIds, consentNow, consentTicketFixture } from './customer-consent.fixtures';
import {
  consentAuditFixture,
  negativeConsentFixture,
  persistedConsentFixture,
} from './customer-consent.persistence.fixtures';
import { ticketRaceBarrier } from './support-ticket-race-barrier';

// Exact accepted C topology and opt-in, never arbitrary URI/env-file credentials.
const owned =
  process.env.ALSM_SUPPORT_TICKET_TEST === 'owned-local-only' ? describe : describe.skip;
owned('Customer Consent persistence on the owned MongoDB replica set', () => {
  const runId = randomUUID().replaceAll('-', ''),
    database = `alsm_customer_consent_${runId}`;
  const uri = `mongodb://127.0.0.1:27127/${database}?replicaSet=alsmPriorities&directConnection=true`;
  let first: Connection,
    second: Connection,
    model: Model<CustomerConsentSnapshot>,
    audits: Model<AuditLog>;
  let repo: MongoCustomerConsentRepository, competitor: MongoCustomerConsentRepository;
  let marked = false;
  const evidence: Record<string, unknown> = {
    runId,
    database,
    replicaSet: 'alsmPriorities',
    highAvailabilityCertified: false,
    observations: [],
  };
  const observations = evidence.observations as unknown[];
  function verifyContainer() {
    const [info] = JSON.parse(
      execFileSync('docker', ['inspect', 'alsm-priorities-20261017-mongo-rs'], {
        encoding: 'utf8',
        windowsHide: true,
      }),
    );
    expect(info.State.Running).toBe(true);
    expect(info.Config.Labels['alsm.owner']).toBe('priorities-20261017');
    expect(info.NetworkSettings.Ports['27017/tcp']).toEqual([
      { HostIp: '127.0.0.1', HostPort: '27127' },
    ]);
  }
  function repository(connection: Connection) {
    const consents = connection.model<CustomerConsentSnapshot>(
      CUSTOMER_CONSENT_MODEL,
      CustomerConsentSchema,
    );
    const auditModel = connection.model(AuditLog.name, AuditLogSchema);
    return new MongoCustomerConsentRepository(consents, (session, selectedConnection) =>
      new MongoAuditRepository(auditModel).inTransaction(session, selectedConnection),
    );
  }
  const auditCount = (id: string) => audits.countDocuments({ resourceId: id });
  async function create(pending = persistedConsentFixture()) {
    expect(await repo.create(pending, consentAuditFixture(pending))).toBe('CONFIRMED');
    return pending;
  }
  async function assertAudit(consent: CustomerConsentEntity, expectedRevision: number | null) {
    const p = consent.toProps(),
      expected = consentAuditFixture(consent, expectedRevision);
    const entries = await audits
      .find({ resourceId: p.consentId, 'metadata.revision': String(p.revision) })
      .lean()
      .exec();
    expect(entries).toHaveLength(1);
    expect({
      actorUserId: String(entries[0].actorUserId),
      organizationId: String(entries[0].organizationId),
      action: entries[0].action,
      resourceType: entries[0].resourceType,
      resourceId: entries[0].resourceId,
      metadata: entries[0].metadata,
    }).toEqual(expected);
  }

  beforeAll(async () => {
    verifyContainer();
    first = await createConnection(uri, {
      autoCreate: false,
      autoIndex: false,
      serverSelectionTimeoutMS: 5000,
      timeoutMS: 10000,
    }).asPromise();
    expect((await first.db!.admin().command({ hello: 1 })).setName).toBe('alsmPriorities');
    expect(await first.db!.listCollections().toArray()).toHaveLength(0);
    await first.collection('_customer_consent_test_owner').insertOne({ runId, database });
    marked = true;
    repo = repository(first);
    model = first.model<CustomerConsentSnapshot>(CUSTOMER_CONSENT_MODEL);
    audits = first.model<AuditLog>(AuditLog.name);
    await model.createCollection();
    await model.createIndexes();
    await audits.createCollection();
    second = await createConnection(uri, {
      autoCreate: false,
      autoIndex: false,
      serverSelectionTimeoutMS: 5000,
      timeoutMS: 10000,
    }).asPromise();
    competitor = repository(second);
    evidence.indexes = await model.collection.indexes();
  }, 20000);
  beforeEach(async () => {
    jest.restoreAllMocks();
    await model.deleteMany({});
    await audits.deleteMany({});
  });
  afterAll(async () => {
    try {
      jest.restoreAllMocks();
      if (first && marked) {
        verifyContainer();
        expect(first.name).toBe(database);
        expect(
          await first.collection('_customer_consent_test_owner').findOne({ runId, database }),
        ).toBeTruthy();
        await first.dropDatabase();
        evidence.databaseDropped = true;
      }
    } finally {
      if (second) await second.close();
      if (first) await first.close();
      const directory = resolve(process.cwd(), 'coverage', 'customer-consent-persistence');
      mkdirSync(directory, { recursive: true });
      const path = resolve(directory, `${runId}.json`);
      writeFileSync(path, JSON.stringify(evidence, null, 2));
      console.log(`CONSENT_DB_EVIDENCE ${path}`);
    }
  });

  it('commits a pending Consent and its real session-bound attributed audit once', async () => {
    const pending = await create();
    expect(
      (
        await repo.findById(pending.toProps().consentId, consentIds.organization, consentIds.ticket)
      )?.toProps(),
    ).toEqual(pending.toProps());
    await assertAudit(pending, null);
    expect(await auditCount(pending.toProps().consentId)).toBe(1);
    expect(
      (await model.collection.indexes()).find(
        (index) => index.name === CUSTOMER_CONSENT_SOURCE_INDEX_NAME,
      ),
    ).toMatchObject({ key: CUSTOMER_CONSENT_SOURCE_INDEX, unique: true });
    observations.push({
      case: 'pending-commit',
      consentId: pending.toProps().consentId,
      consentCount: 1,
      auditCount: 1,
    });
  });
  it.each(['DECLINE', 'INVALIDATE'] as const)(
    'commits %s and exact revisions/audit without changing original history',
    async (action) => {
      const pending = await create(),
        terminal = negativeConsentFixture(pending, action);
      expect(await repo.save(terminal, 0, consentAuditFixture(terminal, 0))).toBe('CONFIRMED');
      const read = (await repo.findById(
        pending.toProps().consentId,
        consentIds.organization,
        consentIds.ticket,
      ))!.toProps();
      expect(read).toEqual(terminal.toProps());
      expect(read.history[0]).toEqual(pending.toProps().history[0]);
      await assertAudit(terminal, 0);
      expect(await auditCount(read.consentId)).toBe(2);
    },
  );
  it('rejects duplicate Consent ID and source event without another mutation/audit', async () => {
    const pending = await create();
    expect(await repo.create(pending, consentAuditFixture(pending))).toBe('CONFLICT');
    const duplicate = persistedConsentFixture({
      sourceId: pending.toProps().requestSource.evidenceId,
    });
    expect(await repo.create(duplicate, consentAuditFixture(duplicate))).toBe('CONFLICT');
    expect(await model.countDocuments()).toBe(1);
    expect(await audits.countDocuments()).toBe(1);
  });
  it('enforces source-event uniqueness on appended decisions as well as creation', async () => {
    const a = await create(),
      b = await create();
    const decisionA = negativeConsentFixture(
      a,
      'DECLINE',
      consentIds.actor,
      'same-source-decision',
    );
    const decisionB = negativeConsentFixture(
      b,
      'DECLINE',
      consentIds.actor,
      'same-source-decision',
    );
    expect(await repo.save(decisionA, 0, consentAuditFixture(decisionA, 0))).toBe('CONFIRMED');
    expect(await repo.save(decisionB, 0, consentAuditFixture(decisionB, 0))).toBe('CONFLICT');
    expect(
      (
        await repo.findById(b.toProps().consentId, consentIds.organization, consentIds.ticket)
      )?.toProps(),
    ).toEqual(b.toProps());
    expect(await auditCount(b.toProps().consentId)).toBe(1);
    expect(await audits.countDocuments()).toBe(3);
  });
  it('uses the documented Organisation/Ticket/episode source identity scope, with no cross-scope discovery', async () => {
    const sourceId = 'same-evidence-in-distinct-scopes';
    const a = await create(persistedConsentFixture({ sourceId }));
    await create(
      persistedConsentFixture({ sourceId, organizationId: consentIds.foreignOrganization }),
    );
    await create(persistedConsentFixture({ sourceId, ticketId: consentIds.nextEpisode }));
    await create(persistedConsentFixture({ sourceId, episodeId: consentIds.nextEpisode }));
    expect(await model.countDocuments()).toBe(4);
    expect(
      await repo.findById(a.toProps().consentId, consentIds.foreignOrganization, consentIds.ticket),
    ).toBeNull();
    expect(
      await repo.findById(a.toProps().consentId, consentIds.organization, consentIds.nextEpisode),
    ).toBeNull();
  });
  it.each(['organization', 'ticket', 'episode'] as const)(
    'does not modify an existing record through another %s scope',
    async (field) => {
      const pending = await create(),
        p = negativeConsentFixture(pending).toProps();
      if (field === 'organization') {
        Object.assign(p, { organizationId: consentIds.foreignOrganization });
        Object.assign(p.customerAuthority, { organizationId: consentIds.foreignOrganization });
      } else if (field === 'ticket') Object.assign(p, { ticketId: consentIds.nextEpisode });
      else Object.assign(p, { episodeId: consentIds.nextEpisode });
      const forged = CustomerConsentEntity.fromPersistence(p);
      expect(await repo.save(forged, 0, consentAuditFixture(forged, 0))).toBe('CONFLICT');
      expect(await auditCount(pending.toProps().consentId)).toBe(1);
      expect(
        (
          await repo.findById(
            pending.toProps().consentId,
            consentIds.organization,
            consentIds.ticket,
          )
        )?.toProps(),
      ).toEqual(pending.toProps());
    },
  );
  it('retains the old episode as incompatible after reopening, without pretending to fence Ticket state', async () => {
    const pending = await create(),
      ticket = consentTicketFixture();
    ticket.close(consentIds.actor, consentNow);
    ticket.reopen(consentIds.actor, consentNow, consentIds.nextEpisode);
    const old = (await repo.findById(
      pending.toProps().consentId,
      consentIds.organization,
      consentIds.ticket,
    ))!.toProps();
    expect(old.episodeId).toBe(consentIds.episode);
    expect(ticketConsentCompatibility(ticket.toProps(), old.episodeId)).toBe('EPISODE_CHANGED');
    expect(old.state).toBe('PENDING_VERIFICATION');
    expect(old).not.toHaveProperty('operationalAccess');
  });
  it('rejects immutable scope, policy and self-consistent original-event rewrites', async () => {
    const pending = await create();
    for (const field of ['scope', 'policy', 'source']) {
      const p = negativeConsentFixture(pending).toProps();
      if (field === 'scope') Object.assign(p.scope, { projectionId: 'rewritten' });
      if (field === 'policy') Object.assign(p.policy, { version: 'rewritten' });
      if (field === 'source') {
        Object.assign(p.requestSource, { evidenceId: 'rewritten' });
        Object.assign(p.history[0].source, { evidenceId: 'rewritten' });
      }
      const forged = CustomerConsentEntity.fromPersistence(p);
      await expect(repo.save(forged, 0, consentAuditFixture(forged, 0))).rejects.toMatchObject({
        status: 409,
      });
    }
    expect(await auditCount(pending.toProps().consentId)).toBe(1);
  });
  it('does not reactivate a terminal record, blindly retry stale CAS or insert terminal snapshots', async () => {
    const pending = await create(),
      terminal = negativeConsentFixture(pending);
    expect(await repo.save(terminal, 0, consentAuditFixture(terminal, 0))).toBe('CONFIRMED');
    expect(await repo.save(terminal, 0, consentAuditFixture(terminal, 0))).toBe('CONFLICT');
    await expect(repo.save(pending, 1, consentAuditFixture(pending, 1))).rejects.toMatchObject({
      status: 409,
    });
    await expect(repo.create(terminal, consentAuditFixture(terminal))).rejects.toMatchObject({
      status: 409,
    });
    expect(await auditCount(pending.toProps().consentId)).toBe(2);
  });
  it('rejects forged audit attribution before either database mutation', async () => {
    const pending = persistedConsentFixture(),
      audit = consentAuditFixture(pending);
    Object.assign(audit, { actorUserId: consentIds.beneficiary });
    await expect(repo.create(pending, audit)).rejects.toMatchObject({ status: 409 });
    expect(await model.countDocuments()).toBe(0);
    expect(await audits.countDocuments()).toBe(0);
  });
  it('fails closed while the required unique index is absent', async () => {
    await model.collection.dropIndex(CUSTOMER_CONSENT_SOURCE_INDEX_NAME);
    try {
      const pending = persistedConsentFixture();
      await expect(repo.create(pending, consentAuditFixture(pending))).rejects.toMatchObject({
        response: { code: 'CUSTOMER_CONSENT_INDEX_REQUIRED' },
      });
      expect(await model.countDocuments()).toBe(0);
      expect(await audits.countDocuments()).toBe(0);
    } finally {
      await model.createIndexes();
    }
  });

  it.each([1, 2, 3])(
    'overlaps distinct snapshot transactions and commits exactly one attributed CAS winner (run %s)',
    async (run) => {
      const pending = await create(),
        p = pending.toProps();
      const left = negativeConsentFixture(pending, 'DECLINE', consentIds.actor);
      const right = negativeConsentFixture(pending, 'INVALIDATE', consentIds.beneficiary);
      const barrier = ticketRaceBarrier({
        ticketId: p.ticketId,
        organizationId: p.organizationId,
        revision: 0,
      });
      const sessions: { participant: string; lsid: string; transaction: string }[] = [];
      const failures: Record<string, { code?: number; unknown: boolean; transient: boolean }[]> = {
        left: [],
        right: [],
      };
      function intercept(connection: Connection, participant: 'left' | 'right') {
        const collection = connection.collection<CustomerConsentSnapshot>('customer_consents'),
          original = collection.updateOne.bind(collection);
        return jest
          .spyOn(collection, 'updateOne')
          .mockImplementationOnce(async (filter, update, options) => {
            try {
              const session = options?.session;
              if (!session) throw new Error('Missing race session');
              expect(filter).toMatchObject({
                _id: p.consentId,
                ticketId: p.ticketId,
                episodeId: p.episodeId,
                revision: 0,
              });
              const stored = await connection
                .model<CustomerConsentSnapshot>(CUSTOMER_CONSENT_MODEL)
                .findOne({ _id: p.consentId, organizationId: filter.organizationId })
                .session(session)
                .lean()
                .exec();
              if (!stored) throw new Error('Missing scoped race Consent');
              sessions.push({
                participant,
                lsid: session.id!.id.toString('hex'),
                transaction: String(session.serverSession?.txnNumber),
              });
              await barrier.arrive({
                participant,
                session,
                ticketId: stored.ticketId,
                organizationId: String(stored.organizationId),
                revision: stored.revision,
              });
              return await original(filter, update, options);
            } catch (error) {
              const cause = error as { code?: number; hasErrorLabel?: (label: string) => boolean };
              failures[participant].push({
                code: cause.code,
                unknown: cause.hasErrorLabel?.('UnknownTransactionCommitResult') === true,
                transient: cause.hasErrorLabel?.('TransientTransactionError') === true,
              });
              throw error;
            }
          });
      }
      const leftSpy = intercept(first, 'left'),
        rightSpy = intercept(second, 'right');
      try {
        const results = await Promise.all([
          repo.save(left, 0, consentAuditFixture(left, 0)),
          competitor.save(right, 0, consentAuditFixture(right, 0)),
        ]);
        barrier.assertReady();
        expect(results.slice().sort()).toEqual(['CONFIRMED', 'CONFLICT']);
        expect(leftSpy).toHaveBeenCalledTimes(1);
        expect(rightSpy).toHaveBeenCalledTimes(1);
        expect(barrier.observations()).toHaveLength(2);
        expect(sessions[0].lsid).not.toBe(sessions[1].lsid);
        const winner = results[0] === 'CONFIRMED' ? left : right,
          loser = results[0] === 'CONFIRMED' ? right : left;
        const storedWinner = (await repo.findById(
          p.consentId,
          p.organizationId,
          p.ticketId,
        ))!.toProps();
        expect(storedWinner).toEqual(winner.toProps());
        expect(storedWinner.history[0]).toEqual(p.history[0]);
        await assertAudit(winner, 0);
        expect(await auditCount(p.consentId)).toBe(2);
        expect(
          await audits.countDocuments({
            resourceId: p.consentId,
            'metadata.revision': '1',
            actorUserId: new Types.ObjectId(loser.toProps().updatedByUserId),
          }),
        ).toBe(0);
        const losingParticipant = results[0] === 'CONFLICT' ? 'left' : 'right';
        expect(
          failures[losingParticipant].some(
            (failure) => failure.code === 112 && failure.transient && !failure.unknown,
          ),
        ).toBe(true);
        observations.push({
          case: 'overlapping-cas',
          run,
          consentId: p.consentId,
          expectedRevision: 0,
          sessions,
          results,
          failures,
          winner: {
            state: storedWinner.state,
            actor: storedWinner.updatedByUserId,
            revision: storedWinner.revision,
          },
          auditCount: 2,
          losingRevisionAuditCount: 0,
        });
      } finally {
        barrier.cancel();
        leftSpy.mockRestore();
        rightSpy.mockRestore();
      }
    },
  );
  it('rolls back the real Consent insert when bound audit insertion fails after writing', async () => {
    const pending = persistedConsentFixture(),
      append = MongoAuditRepository.prototype.append;
    jest.spyOn(MongoAuditRepository.prototype, 'append').mockImplementationOnce(async function (
      this: MongoAuditRepository,
      input,
    ) {
      await append.call(this, input);
      throw new Error('TEST after real audit insert');
    });
    await expect(repo.create(pending, consentAuditFixture(pending))).rejects.toMatchObject({
      response: { code: 'ATOMIC_MUTATION_ABORTED' },
    });
    expect(await model.countDocuments()).toBe(0);
    expect(await audits.countDocuments()).toBe(0);
    observations.push({ case: 'audit-rollback', consentCount: 0, auditCount: 0 });
  });
  it('rolls back a real Consent insert when persistence acknowledgement fails before audit', async () => {
    const pending = persistedConsentFixture(),
      collection = first.collection<CustomerConsentSnapshot>('customer_consents'),
      insert = collection.insertOne.bind(collection);
    jest.spyOn(collection, 'insertOne').mockImplementationOnce(async (...args) => {
      await insert(...args);
      throw new Error('TEST after real Consent insert, before audit');
    });
    await expect(repo.create(pending, consentAuditFixture(pending))).rejects.toMatchObject({
      response: { code: 'ATOMIC_MUTATION_ABORTED' },
    });
    expect(await model.countDocuments()).toBe(0);
    expect(await audits.countDocuments()).toBe(0);
    observations.push({ case: 'consent-rollback', consentCount: 0, auditCount: 0 });
  });
  it.each(['create', 'save'] as const)(
    'retains unconfirmed %s after real commit acknowledgement loss, with zero business replay',
    async (operation) => {
      const pending = operation === 'save' ? await create() : persistedConsentFixture();
      const target = operation === 'save' ? negativeConsentFixture(pending) : pending;
      const start = first.startSession.bind(first),
        commits = jest.fn();
      let convenienceCalls = 0;
      const startSpy = jest.spyOn(first, 'startSession').mockImplementationOnce(async (...args) => {
        const session = await start(...args),
          commit = session.commitTransaction.bind(session);
        jest.spyOn(session, 'withTransaction').mockImplementation(async () => {
          convenienceCalls++;
          throw new Error('TEST convenience API forbidden');
        });
        jest.spyOn(session, 'commitTransaction').mockImplementationOnce(async () => {
          commits();
          await commit();
          throw new mongo.MongoServerError({
            message: 'TEST acknowledgement lost after real commit',
            code: 50,
            errorLabels: ['UnknownTransactionCommitResult', 'TransientTransactionError'],
          });
        });
        return session;
      });
      const collection = first.collection<CustomerConsentSnapshot>('customer_consents');
      const writes =
        operation === 'create'
          ? jest.spyOn(collection, 'insertOne')
          : jest.spyOn(collection, 'updateOne');
      const append = jest.spyOn(MongoAuditRepository.prototype, 'append');
      const expectedRevision = operation === 'save' ? 0 : null;
      await expect(
        writeCustomerConsent(target, expectedRevision, (audit) =>
          operation === 'create' ? repo.create(target, audit) : repo.save(target, 0, audit),
        ),
      ).rejects.toMatchObject({
        status: 503,
        response: {
          code: 'CUSTOMER_CONSENT_OUTCOME_UNCONFIRMED',
          details: [
            expect.objectContaining({
              consentId: target.toProps().consentId,
              organizationId: consentIds.organization,
              ticketId: consentIds.ticket,
              episodeId: consentIds.episode,
              revision: target.toProps().revision,
              expectedRevision,
              mutationCommitted: 'unknown',
              retrySafe: false,
            }),
          ],
        },
      });
      expect(startSpy).toHaveBeenCalledTimes(1);
      expect(commits).toHaveBeenCalledTimes(1);
      expect(writes).toHaveBeenCalledTimes(1);
      expect(append).toHaveBeenCalledTimes(1);
      expect(convenienceCalls).toBe(0);
      expect(
        (
          await repo.findById(
            target.toProps().consentId,
            consentIds.organization,
            consentIds.ticket,
          )
        )?.toProps(),
      ).toEqual(target.toProps());
      await assertAudit(target, expectedRevision);
      expect(await auditCount(target.toProps().consentId)).toBe(operation === 'save' ? 2 : 1);
      observations.push({
        case: 'post-commit-acknowledgement-loss',
        operation,
        consentId: target.toProps().consentId,
        publicOutcome: 'UNCONFIRMED',
        businessWrites: writes.mock.calls.length,
        auditWrites: append.mock.calls.length,
        commitMethodCalls: commits.mock.calls.length,
        convenienceCalls,
        actualStoredRevision: target.toProps().revision,
      });
    },
  );
  it.each(['state', 'revision', 'coverage'] as const)(
    'rejects corrupt raw %s without hydration repair or a false success',
    async (field) => {
      const pending = await create();
      const raw = first.collection<{ _id: string; [field: string]: unknown }>('customer_consents');
      if (field === 'state')
        await raw.updateOne(
          { _id: pending.toProps().consentId },
          { $set: { state: 'VERIFIED_GRANTED' } },
        );
      if (field === 'revision')
        await raw.updateOne({ _id: pending.toProps().consentId }, { $set: { revision: 2 } });
      if (field === 'coverage')
        await raw.updateOne({ _id: pending.toProps().consentId }, { $unset: { coverage: '' } });
      await expect(
        repo.findById(pending.toProps().consentId, consentIds.organization, consentIds.ticket),
      ).rejects.toMatchObject({ response: { code: 'CUSTOMER_CONSENT_SNAPSHOT_INVALID' } });
      const terminal = negativeConsentFixture(pending);
      await expect(repo.save(terminal, 0, consentAuditFixture(terminal, 0))).rejects.toMatchObject({
        response: { code: 'CUSTOMER_CONSENT_SNAPSHOT_INVALID' },
      });
      expect(await auditCount(pending.toProps().consentId)).toBe(1);
    },
  );
});
