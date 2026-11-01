import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Connection, createConnection, Model, mongo } from 'mongoose';
import { MongoAuditRepository } from '../src/modules/audit/infrastructure/mongo-audit.repository';
import { AuditLog, AuditLogSchema } from '../src/modules/audit/infrastructure/audit-log.schema';
import { MongoConsentIntentConsumption } from '../src/modules/support/infrastructure/mongo-consent-intent-consumption';
import {
  CONSENT_INTENT_CHALLENGE_MODEL,
  CONSENT_INTENT_TRUST_MODEL,
  CONSENT_INTENT_RECEIPT_MODEL,
  CONSENT_INTENT_RECEIPT_INDEXES,
  CONSENT_INTENT_AUDIT_INDEX,
  ConsentIntentChallengeSchema,
  ConsentIntentTrustSchema,
  ConsentIntentReceiptSchema,
  ConsentIntentChallengeSnapshot,
  ConsentIntentTrustSnapshot,
  ConsentIntentReceiptSnapshot,
} from '../src/modules/support/infrastructure/consent-intent.schema';
import { consentIds } from './customer-consent.fixtures';
import { ticketRaceBarrier } from './support-ticket-race-barrier';
import {
  intentFixture,
  intentReconciliation,
  intentRegistration,
  intentReordered,
} from './consent-intent.persistence.fixtures';
import type { DurableIntentConsumption } from '../src/modules/support/application/consent-verification-foundation.port';

// Same reviewed topology/ownership gate as C/E2. Never arbitrary URIs or .env credentials.
const owned =
  process.env.ALSM_SUPPORT_TICKET_TEST === 'owned-local-only' ? describe : describe.skip;
owned('E5B synthetic intent consumption on the owned real MongoDB replica set', () => {
  const runId = randomUUID().replaceAll('-', ''),
    database = `alsm_consent_intent_${runId}`;
  const uri = `mongodb://127.0.0.1:27127/${database}?replicaSet=alsmPriorities&directConnection=true`;
  let first: Connection,
    second: Connection,
    repo: MongoConsentIntentConsumption,
    competitor: MongoConsentIntentConsumption;
  let challenges: Model<ConsentIntentChallengeSnapshot>,
    trust: Model<ConsentIntentTrustSnapshot>,
    receipts: Model<ConsentIntentReceiptSnapshot>,
    audits: Model<AuditLog>;
  let marked = false;
  const evidence: Record<string, unknown> = {
    runId,
    database,
    replicaSet: 'alsmPriorities',
    trust: 'SYNTHETIC_ONLY',
    externalProofAuthenticated: false,
    failoverCertified: false,
    observations: [],
  };
  const observations = evidence.observations as unknown[];
  const rawChallenges = () =>
    first.collection<ConsentIntentChallengeSnapshot>(challenges.collection.name);
  const rawReceipts = () =>
    first.collection<ConsentIntentReceiptSnapshot>(receipts.collection.name);
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
    const models = {
      challenges: connection.model<ConsentIntentChallengeSnapshot>(
        CONSENT_INTENT_CHALLENGE_MODEL,
        ConsentIntentChallengeSchema,
      ),
      trust: connection.model<ConsentIntentTrustSnapshot>(
        CONSENT_INTENT_TRUST_MODEL,
        ConsentIntentTrustSchema,
      ),
      receipts: connection.model<ConsentIntentReceiptSnapshot>(
        CONSENT_INTENT_RECEIPT_MODEL,
        ConsentIntentReceiptSchema,
      ),
      audits: connection.model<AuditLog>(AuditLog.name, AuditLogSchema),
    };
    return new MongoConsentIntentConsumption(models, (session, sameConnection) =>
      new MongoAuditRepository(models.audits).inTransaction(session, sameConnection),
    );
  }
  async function seed(c = intentFixture()) {
    expect(await repo.registerSynthetic(intentRegistration(c))).toBe('CONFIRMED');
    return c;
  }
  async function counts() {
    return {
      challenges: await challenges.countDocuments(),
      receipts: await receipts.countDocuments(),
      audits: await audits.countDocuments(),
    };
  }
  async function assertUnconsumed(c: DurableIntentConsumption) {
    expect(await rawChallenges().findOne({ _id: c.evidence.challenge.challengeId })).toMatchObject({
      state: 'ISSUED',
      revision: 0,
      consumptionId: null,
    });
    expect(await receipts.countDocuments({ _id: c.consumptionId })).toBe(0);
    expect(await audits.countDocuments({ resourceId: c.consumptionId })).toBe(0);
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
    await first.collection('_consent_intent_test_owner').insertOne({ runId, database });
    marked = true;
    repo = repository(first);
    challenges = first.model<ConsentIntentChallengeSnapshot>(CONSENT_INTENT_CHALLENGE_MODEL);
    trust = first.model<ConsentIntentTrustSnapshot>(CONSENT_INTENT_TRUST_MODEL);
    receipts = first.model<ConsentIntentReceiptSnapshot>(CONSENT_INTENT_RECEIPT_MODEL);
    audits = first.model<AuditLog>(AuditLog.name);
    for (const model of [challenges, trust, receipts, audits]) {
      await model.createCollection();
      await model.createIndexes();
    }
    await audits.collection.createIndex(CONSENT_INTENT_AUDIT_INDEX.key, {
      name: CONSENT_INTENT_AUDIT_INDEX.name,
      unique: true,
      partialFilterExpression: CONSENT_INTENT_AUDIT_INDEX.partialFilterExpression,
      collation: { locale: 'simple' },
    });
    second = await createConnection(uri, {
      autoCreate: false,
      autoIndex: false,
      serverSelectionTimeoutMS: 5000,
      timeoutMS: 10000,
    }).asPromise();
    competitor = repository(second);
    evidence.indexes = {
      challenges: await challenges.collection.indexes(),
      receipts: await receipts.collection.indexes(),
      trust: await trust.collection.indexes(),
      audits: await audits.collection.indexes(),
    };
  }, 20000);
  beforeEach(async () => {
    jest.restoreAllMocks();
    for (const model of [challenges, trust, receipts, audits])
      await first.collection(model.collection.name).deleteMany({});
    await receipts.createIndexes();
  });
  afterAll(async () => {
    try {
      jest.restoreAllMocks();
      if (first && marked) {
        verifyContainer();
        expect(first.name).toBe(database);
        expect(database).toMatch(/^alsm_consent_intent_[a-f0-9]{32}$/);
        expect(
          await first.collection('_consent_intent_test_owner').findOne({ runId, database }),
        ).toBeTruthy();
        await first.dropDatabase();
        evidence.databaseDropped = true;
      }
    } finally {
      const cleanup = await Promise.allSettled([second?.close(), first?.close()]);
      evidence.connectionsClosed = cleanup.every((r) => r.status === 'fulfilled');
      const directory = resolve(process.cwd(), 'coverage', 'consent-intent-persistence');
      mkdirSync(directory, { recursive: true });
      const path = resolve(directory, `${runId}.json`);
      writeFileSync(path, JSON.stringify(evidence, null, 2));
      console.log(`CONSENT_INTENT_DB_EVIDENCE ${path}`);
      expect(evidence.connectionsClosed).toBe(true);
    }
  });

  it('provisions effective global uniqueness for server challenge nonce and consumed proof', async () => {
    const c = await seed();
    const raw = await rawChallenges().findOne({ _id: c.evidence.challenge.challengeId });
    await expect(rawChallenges().insertOne({ ...raw!, _id: randomUUID() })).rejects.toMatchObject({
      code: 11000,
    });
    expect(
      (await receipts.collection.indexes()).find(
        (i) => i.name === 'intent_receipt_proof_global_unique',
      ),
    ).toMatchObject({ key: { proofIssuerId: 1, proofId: 1 }, unique: true });
    expect(await challenges.countDocuments()).toBe(1);
  });
  it.each(['REQUEST', 'DECLINE'] as const)(
    'commits %s consumption, immutable receipt and correctly attributed audit together',
    async (action) => {
      const c = await seed(intentFixture({ action }));
      const persisted = await rawChallenges().findOne({ _id: c.evidence.challenge.challengeId });
      const update = jest.spyOn(rawChallenges(), 'updateOne');
      expect((await repo.consume(intentReordered(c))).outcome).toBe('CONFIRMED');
      expect(mongo.BSON.serialize({ registration: update.mock.calls[0][0].registration })).toEqual(
        mongo.BSON.serialize({ registration: persisted!.registration }),
      );
      expect(await counts()).toEqual({ challenges: 1, receipts: 1, audits: 1 });
      expect(await repo.reconcile(intentReconciliation(c))).toMatchObject({
        status: 'COMMITTED',
        outcome: 'CONFIRMED',
        operationalAccess: false,
      });
      const stored = await rawReceipts().findOne({ _id: c.consumptionId });
      const audit = await audits.collection.findOne({ _id: stored!.auditId });
      expect(String(audit!.actorUserId)).toBe(c.request.actorUserId);
      expect(String(audit!.organizationId)).toBe(c.request.ticket.organizationId);
      expect(audit!.metadata).toMatchObject({
        state: 'CONSUMED',
        consentAction: action,
        ticketId: c.request.ticket.ticketId,
        episodeId: c.request.ticket.episodeId,
        purposeId: c.request.scope.purposeId,
        challengeId: c.evidence.challenge.challengeId,
        proofId: c.request.source!.evidenceId,
      });
      observations.push({
        case: 'atomic-consumption',
        action,
        registrationBsonMatched: true,
        callerOrderNormalized: true,
        consumptionId: c.consumptionId,
        ...(await counts()),
      });
    },
  );
  it('rejects duplicate delivery without claiming a second success', async () => {
    const c = await seed();
    await repo.consume(c);
    const duplicate = { ...c, consumptionId: randomUUID() };
    expect((await repo.consume(duplicate)).outcome).toBe('REJECTED');
    expect(await repo.reconcile(intentReconciliation(duplicate))).toMatchObject({
      status: 'ALREADY_CONSUMED',
      outcome: 'REJECTED',
    });
    expect(await counts()).toEqual({ challenges: 1, receipts: 1, audits: 1 });
  });
  it.each(['another-action', 'new-reference-revision', 'another-Organisation'])(
    'rejects a reused proof across %s and rolls back its temporary state/audit',
    async (kind) => {
      const a = await seed();
      await repo.consume(a);
      const b = await seed(
        intentFixture({
          proofId: a.request.source!.evidenceId,
          proofRevision: kind === 'new-reference-revision' ? 'r2' : undefined,
          action: kind === 'another-action' ? 'DECLINE' : 'REQUEST',
          organizationId:
            kind === 'another-Organisation' ? consentIds.foreignOrganization : undefined,
        }),
      );
      expect((await repo.consume(b)).outcome).toBe('REJECTED');
      await assertUnconsumed(b);
      expect(await counts()).toEqual({ challenges: 2, receipts: 1, audits: 1 });
      observations.push({ case: 'global-proof-reuse', dimension: kind, ...(await counts()) });
    },
  );
  it('allows one winner with two distinct active MongoDB transaction sessions at a bounded barrier', async () => {
    const c = await seed();
    const barrier = ticketRaceBarrier({
      ticketId: c.request.ticket.ticketId,
      organizationId: c.request.ticket.organizationId,
      revision: 0,
    });
    const sessions: { participant: string; lsid: string; transaction: string }[] = [];
    function intercept(connection: Connection, participant: 'left' | 'right') {
      const collection = connection.collection<ConsentIntentChallengeSnapshot>(
          challenges.collection.name,
        ),
        original = collection.findOne.bind(collection);
      return jest.spyOn(collection, 'findOne').mockImplementationOnce(async (filter, options) => {
        try {
          const stored = await original(filter, options),
            session = options?.session;
          if (!stored || !session) throw Error('Missing scoped challenge or transaction');
          sessions.push({
            participant,
            lsid: session.id!.id.toString('hex'),
            transaction: String(session.serverSession?.txnNumber),
          });
          await barrier.arrive({
            participant,
            session,
            ticketId: stored.ticketId,
            organizationId: stored.organizationId.toHexString(),
            revision: stored.revision,
          });
          return stored;
        } catch (error) {
          barrier.cancel(error instanceof Error ? error : new Error('Race participant failed'));
          throw error;
        }
      });
    }
    const left = intercept(first, 'left'),
      right = intercept(second, 'right');
    try {
      const outcomes = await Promise.all([
        repo.consume(c),
        competitor.consume({ ...c, consumptionId: randomUUID() }),
      ]);
      barrier.assertReady();
      expect(new Set(sessions.map((s) => s.lsid)).size).toBe(2);
      expect(outcomes.map((r) => r.outcome).sort()).toEqual(['CONFIRMED', 'REJECTED']);
      expect(await counts()).toEqual({ challenges: 1, receipts: 1, audits: 1 });
      observations.push({
        case: 'distinct-session-race',
        sessions,
        outcomes: outcomes.map((r) => r.outcome),
        ...(await counts()),
      });
    } finally {
      left.mockRestore();
      right.mockRestore();
      barrier.cancel();
    }
  }, 20000);
  it('rolls back consumption and receipt when the real audit participant fails', async () => {
    const c = await seed();
    jest
      .spyOn(MongoAuditRepository.prototype, 'append')
      .mockRejectedValueOnce(Error('TEST private audit failure'));
    await expect(repo.consume(c)).rejects.toMatchObject({ status: 503 });
    await assertUnconsumed(c);
    observations.push({ case: 'audit-failure-rollback', ...(await counts()) });
  });
  it('leaves no orphan audit if receipt insertion fails after real audit insertion', async () => {
    const c = await seed(),
      collection = first.collection<ConsentIntentReceiptSnapshot>(receipts.collection.name);
    const append = jest.spyOn(MongoAuditRepository.prototype, 'append');
    jest.spyOn(collection, 'insertOne').mockRejectedValueOnce(Error('TEST receipt insert failed'));
    await expect(repo.consume(c)).rejects.toMatchObject({ status: 503 });
    expect(append).toHaveBeenCalledTimes(1);
    await assertUnconsumed(c);
    observations.push({ case: 'receipt-failure-no-orphan-audit', ...(await counts()) });
  });
  it.each([true, false])(
    'returns UNCONFIRMED for injected commit acknowledgement loss with actual commit=%s, without replay',
    async (actualCommit) => {
      const c = await seed(),
        start = first.startSession.bind(first),
        commits = jest.fn();
      const startSpy = jest.spyOn(first, 'startSession').mockImplementationOnce(async (...args) => {
        const session = await start(...args),
          commit = session.commitTransaction.bind(session);
        jest.spyOn(session, 'withTransaction').mockImplementation(async () => {
          throw Error('TEST replay helper forbidden');
        });
        jest.spyOn(session, 'commitTransaction').mockImplementationOnce(async () => {
          commits();
          if (actualCommit) await commit();
          else await session.abortTransaction();
          throw new mongo.MongoServerError({
            message: 'TEST injected acknowledgement loss',
            code: 50,
            errorLabels: ['UnknownTransactionCommitResult', 'TransientTransactionError'],
          });
        });
        return session;
      });
      const append = jest.spyOn(MongoAuditRepository.prototype, 'append');
      const changed = jest.spyOn(
        first.collection<ConsentIntentChallengeSnapshot>(challenges.collection.name),
        'updateOne',
      );
      const inserted = jest.spyOn(
        first.collection<ConsentIntentReceiptSnapshot>(receipts.collection.name),
        'insertOne',
      );
      const result = await repo.consume(c);
      expect(result).toMatchObject({
        outcome: 'UNCONFIRMED',
        consumptionId: c.consumptionId,
        verificationAttemptId: c.request.verificationAttemptId,
        challengeId: c.evidence.challenge.challengeId,
      });
      expect(commits).toHaveBeenCalledTimes(1);
      expect(append).toHaveBeenCalledTimes(1);
      expect(changed).toHaveBeenCalledTimes(1);
      expect(inserted).toHaveBeenCalledTimes(1);
      startSpy.mockRestore();
      expect(await repo.reconcile(intentReconciliation(c))).toMatchObject({
        status: actualCommit ? 'COMMITTED' : 'ABSENT_UNCERTAIN',
        outcome: actualCommit ? 'CONFIRMED' : 'UNCONFIRMED',
      });
      expect(changed).toHaveBeenCalledTimes(1);
      expect(inserted).toHaveBeenCalledTimes(1);
      expect(append).toHaveBeenCalledTimes(1);
      observations.push({
        case: 'injected-commit-acknowledgement-loss',
        actualCommit,
        businessReplays: 0,
        reconciliation: actualCommit ? 'COMMITTED' : 'ABSENT_UNCERTAIN',
        ...(await counts()),
      });
    },
  );
  it('denies cross-Organisation reconciliation without foreign metadata', async () => {
    const c = await seed();
    await repo.consume(c);
    const foreign = intentReconciliation(c);
    Object.assign(foreign.request.ticket, { organizationId: consentIds.foreignOrganization });
    await expect(repo.reconcile(foreign)).rejects.toMatchObject({
      status: 403,
      response: { code: 'CONSENT_INTENT_RECONCILIATION_DENIED' },
    });
  });
  it.each(['audit', 'receipt'])(
    'does not confirm a committed state with missing %s evidence',
    async (kind) => {
      const c = await seed();
      await repo.consume(c);
      if (kind === 'audit') await audits.deleteOne({ resourceId: c.consumptionId });
      else await receipts.deleteOne({ _id: c.consumptionId });
      expect(await repo.reconcile(intentReconciliation(c))).toMatchObject({
        status: 'EVIDENCE_INCONSISTENT',
        outcome: 'UNCONFIRMED',
      });
    },
  );
  it('fails closed on corrupt stored snapshots without new audit or receipt', async () => {
    const c = await seed();
    await rawChallenges().updateOne(
      { _id: c.evidence.challenge.challengeId },
      { $set: { revision: 7 } },
    );
    await expect(repo.consume(c)).rejects.toMatchObject({
      status: 503,
      response: { code: 'CONSENT_INTENT_SNAPSHOT_INVALID' },
    });
    expect(await receipts.countDocuments()).toBe(0);
    expect(await audits.countDocuments()).toBe(0);
  });
  it('requires the globally unique proof index before any mutation', async () => {
    const c = await seed(),
      index = CONSENT_INTENT_RECEIPT_INDEXES.find(
        (i) => i.name === 'intent_receipt_proof_global_unique',
      )!;
    await receipts.collection.dropIndex(index.name);
    try {
      await expect(repo.consume(c)).rejects.toMatchObject({
        status: 503,
        response: { code: 'CONSENT_INTENT_INDEX_REQUIRED' },
      });
      await assertUnconsumed(c);
    } finally {
      await receipts.createIndexes();
    }
  });
  it('rejects locally revoked synthetic trust before committing consumption', async () => {
    const c = await seed();
    await trust.collection.updateOne({ kind: 'PERSON' }, { $set: { state: 'REVOKED' } });
    expect((await repo.consume(c)).outcome).toBe('REJECTED');
    await assertUnconsumed(c);
  });
  it('conflicts with a local revocation committed after a snapshot read and before its fence write', async () => {
    const c = await seed(),
      collection = first.collection<ConsentIntentTrustSnapshot>(trust.collection.name);
    const read = collection.findOne.bind(collection);
    let revoked = false;
    const spy = jest.spyOn(collection, 'findOne').mockImplementation(async (filter, options) => {
      const stored = await read(filter, options);
      if (!revoked && stored?.kind === 'PERSON' && options?.session) {
        revoked = true;
        await second
          .collection<ConsentIntentTrustSnapshot>(trust.collection.name)
          .updateOne({ _id: stored._id }, { $set: { state: 'REVOKED' } });
      }
      return stored;
    });
    try {
      expect((await repo.consume(c)).outcome).toBe('REJECTED');
      expect(revoked).toBe(true);
      await assertUnconsumed(c);
      expect(await trust.countDocuments({ state: 'REVOKED' })).toBe(1);
      observations.push({
        case: 'local-revocation-after-snapshot-read',
        consumptionCommitted: false,
        ...(await counts()),
      });
    } finally {
      spy.mockRestore();
    }
  });
});
