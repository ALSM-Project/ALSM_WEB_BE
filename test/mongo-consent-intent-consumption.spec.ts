import { Logger } from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';
import { ClientSession, Connection, Model, Types, mongo } from 'mongoose';
import {
  MongoConsentIntentConsumption,
  ConsentIntentModels,
} from '../src/modules/support/infrastructure/mongo-consent-intent-consumption';
import {
  CONSENT_INTENT_CHALLENGE_INDEXES,
  CONSENT_INTENT_RECEIPT_INDEXES,
  CONSENT_INTENT_AUDIT_INDEX,
  ConsentIntentChallengeSnapshot,
  ConsentIntentReceiptSnapshot,
  ConsentIntentTrustSnapshot,
} from '../src/modules/support/infrastructure/consent-intent.schema';
import {
  intentChallengeFromSnapshot,
  intentReceiptFromSnapshot,
  intentHash,
  captureIntentConsumption,
} from '../src/modules/support/infrastructure/consent-intent.mapper';
import { consentDataCopy } from '../src/modules/support/domain/customer-consent.validation';
import { consentIds } from './customer-consent.fixtures';
import {
  intentBsonCopy,
  intentFixture,
  intentReconciliation,
  intentRegistration,
  intentReordered,
} from './consent-intent.persistence.fixtures';
import type { AuditRepository } from '../src/modules/audit/domain/audit.repository';

type Row = Record<string, unknown>;
const names = ['challenges', 'trust', 'receipts', 'audits'] as const;
type Name = (typeof names)[number];
const empty = () =>
  Object.fromEntries(names.map((n) => [n, new Map<string, Row>()])) as Record<
    Name,
    Map<string, Row>
  >;
const duplicate = () => new mongo.MongoServerError({ message: 'synthetic duplicate', code: 11000 });
const pathValue = (row: Row, path: string): unknown =>
  path.split('.').reduce<unknown>((v, k) => (v as Row)?.[k], row);
const bson = (value: unknown) => Buffer.from(mongo.BSON.serialize({ value }));
function matches(row: Row, filter: Row) {
  return Object.entries(filter).every(([key, expected]) =>
    key === '$expr'
      ? Number(pathValue(row, 'registration.evidence.challenge.expiresAtMs')) > Date.now()
      : key === 'registration' || key === 'payload'
        ? bson(pathValue(row, key)).equals(bson(expected))
        : isDeepStrictEqual(pathValue(row, key), expected),
  );
}

/** Staged, explicitly synthetic transaction fixture; NEVER evidence of MongoDB atomicity. */
function fixture() {
  let committed = empty();
  const clone = () =>
    Object.fromEntries(
      names.map((n) => [n, new Map([...committed[n]].map(([k, v]) => [k, intentBsonCopy(v)]))]),
    ) as ReturnType<typeof empty>;
  const control = {
    commitError: undefined as unknown,
    persistCommitError: true,
    auditError: undefined as unknown,
    insertError: undefined as { name: Name; error: unknown } | undefined,
    acknowledged: true,
    abortError: undefined as unknown,
    endError: undefined as unknown,
  };
  const locks = new Map<string, object>();
  const sessions: ReturnType<typeof session>[] = [];
  function session() {
    let active = false;
    const s = {
      explicit: true,
      hasEnded: false,
      transaction: { state: 'NO_TRANSACTION' },
      staged: empty(),
      inTransaction: () => active,
      startTransaction: jest.fn(() => {
        active = true;
        s.staged = clone();
        s.transaction = { state: 'TRANSACTION_IN_PROGRESS' };
      }),
      commitTransaction: jest.fn(async () => {
        if (!control.commitError || control.persistCommitError) committed = s.staged;
        active = false;
        release();
        s.transaction.state = 'TRANSACTION_COMMITTED';
        if (control.commitError) throw control.commitError;
      }),
      abortTransaction: jest.fn(async () => {
        active = false;
        release();
        if (control.abortError) throw control.abortError;
      }),
      endSession: jest.fn(async () => {
        s.hasEnded = true;
        release();
        if (control.endError) throw control.endError;
      }),
      withTransaction: jest.fn(() => {
        throw Error('Callback replay forbidden');
      }),
    };
    function release() {
      for (const [key, owner] of locks) if (owner === s) locks.delete(key);
    }
    return s;
  }
  const rows = (name: Name) => [...committed[name].values()];
  const id = (v: unknown) => (v instanceof Types.ObjectId ? v.toHexString() : String(v));
  const selected = (name: Name, options: { session?: ClientSession }) => {
    const s = options.session as unknown as ReturnType<typeof session>;
    expect(s.explicit && !s.hasEnded && s.inTransaction()).toBe(true);
    return { s, data: s.staged[name] };
  };
  const collections = Object.fromEntries(
    names.map((name) => {
      const specs =
        name === 'challenges'
          ? CONSENT_INTENT_CHALLENGE_INDEXES
          : name === 'receipts'
            ? CONSENT_INTENT_RECEIPT_INDEXES
            : name === 'audits'
              ? [CONSENT_INTENT_AUDIT_INDEX]
              : [];
      const indexes: Row[] = [
        { name: '_id_', key: { _id: 1 } },
        ...specs.map((i) => ({ ...i, unique: true, collation: { locale: 'simple' } })),
      ];
      const collection = {
        indexes: jest.fn(async () => intentBsonCopy(indexes)),
        findOne: jest.fn(async (filter: Row, options: { session?: ClientSession }) => {
          const { data } = selected(name, options);
          return intentBsonCopy([...data.values()].find((row) => matches(row, filter)) ?? null);
        }),
        find: jest.fn((filter: Row, options: { session?: ClientSession }) => {
          let limit = Infinity;
          const cursor = {
            limit: (count: number) => {
              limit = count;
              return cursor;
            },
            toArray: async () =>
              intentBsonCopy(
                [...selected(name, options).data.values()]
                  .filter((row) => matches(row, filter))
                  .slice(0, limit),
              ),
          };
          return cursor;
        }),
        insertOne: jest.fn(async (value: Row, options: { session?: ClientSession }) => {
          if (control.insertError?.name === name) throw control.insertError.error;
          const { data } = selected(name, options);
          if (data.has(id(value._id))) throw duplicate();
          for (const spec of specs) {
            if (spec.partialFilterExpression && !matches(value, spec.partialFilterExpression))
              continue;
            if (
              [...data.values()].some(
                (row) =>
                  (!spec.partialFilterExpression || matches(row, spec.partialFilterExpression)) &&
                  Object.keys(spec.key).every((k) =>
                    isDeepStrictEqual(pathValue(row, k), pathValue(value, k)),
                  ),
              )
            )
              throw duplicate();
          }
          data.set(id(value._id), intentBsonCopy(value));
          return { acknowledged: control.acknowledged, insertedId: value._id };
        }),
        updateOne: jest.fn(
          async (
            filter: Row,
            update: { $set?: Row; $inc?: Record<string, number> },
            options: { session?: ClientSession },
          ) => {
            const { s, data } = selected(name, options),
              row = [...data.values()].find((r) => matches(r, filter));
            if (!row) return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
            const lock = `${name}:${id(row._id)}`;
            if (locks.has(lock) && locks.get(lock) !== s)
              throw new mongo.MongoServerError({ message: 'synthetic write conflict', code: 112 });
            locks.set(lock, s);
            Object.assign(row, intentBsonCopy(update.$set ?? {}));
            for (const [k, n] of Object.entries(update.$inc ?? {})) row[k] = Number(row[k]) + n;
            return { acknowledged: control.acknowledged, matchedCount: 1, modifiedCount: 1 };
          },
        ),
      };
      return [name, collection];
    }),
  ) as Record<
    Name,
    {
      indexes: jest.Mock<Promise<Row[]>, []>;
      findOne: jest.Mock<Promise<Row | null>, [Row, { session?: ClientSession }]>;
      find: jest.Mock;
      insertOne: jest.Mock<
        Promise<{ acknowledged: boolean; insertedId: unknown }>,
        [Row, { session?: ClientSession }]
      >;
      updateOne: jest.Mock<
        Promise<{ acknowledged: boolean; matchedCount: number; modifiedCount: number }>,
        [Row, { $set?: Row; $inc?: Record<string, number> }, { session?: ClientSession }]
      >;
    }
  >;
  const hello = jest.fn(async () => ({ setName: 'synthetic-rs' }));
  const connection = {
    startSession: jest.fn(async () => {
      const created = session();
      sessions.push(created);
      return created;
    }),
    collection: (name: Name) => collections[name],
    db: { collection: (name: Name) => collections[name], admin: () => ({ command: hello }) },
  } as unknown as Connection;
  const model = <T>(name: Name) =>
    ({ db: connection, collection: { name } }) as unknown as Model<T>;
  const models: ConsentIntentModels = {
    challenges: model<ConsentIntentChallengeSnapshot>('challenges'),
    trust: model<ConsentIntentTrustSnapshot>('trust'),
    receipts: model<ConsentIntentReceiptSnapshot>('receipts'),
    audits: model('audits'),
  };
  const append = jest.fn(
    async (input: Parameters<AuditRepository['append']>[0], session: ClientSession) => {
      if (control.auditError) throw control.auditError;
      await collections.audits.insertOne(
        {
          ...input,
          _id: new Types.ObjectId(),
          createdAt: new Date(),
          actorUserId: new Types.ObjectId(input.actorUserId),
          organizationId: new Types.ObjectId(input.organizationId),
        },
        { session },
      );
    },
  );
  const audit = jest.fn((session: ClientSession, sameConnection: Connection) => {
    expect(sameConnection).toBe(connection);
    return { append: (input: Parameters<AuditRepository['append']>[0]) => append(input, session) };
  });
  const repo = new MongoConsentIntentConsumption(models, audit);
  const seed = async (c = intentFixture()) => {
    expect(await repo.registerSynthetic(intentRegistration(c))).toBe('CONFIRMED');
    return c;
  };
  return { repo, models, rows, collections, sessions, control, hello, audit, append, seed };
}

describe('E5B Mongo consent intent adapter (synthetic staged unit fixture)', () => {
  afterEach(() => jest.restoreAllMocks());
  it.each(['REQUEST', 'DECLINE'] as const)(
    'normalizes reordered %s input to the complete persisted BSON registration',
    async (action) => {
      const f = fixture(),
        c = await f.seed(intentReordered(intentFixture({ action }))),
        input = intentReordered(c),
        before = bson(input),
        persisted = f.rows('challenges')[0].registration;
      expect((await f.repo.consume(input)).outcome).toBe('CONFIRMED');
      const query = f.collections.challenges.updateOne.mock.calls[0][0].registration;
      expect(bson(query)).toEqual(bson(persisted));
      expect(bson(input)).toEqual(before);
      function canonicalKeys(value: unknown) {
        if (Array.isArray(value)) value.forEach(canonicalKeys);
        else if (value && typeof value === 'object') {
          expect(Object.keys(value)).toEqual(Object.keys(value).sort());
          expect(Object.isFrozen(value)).toBe(true);
          Object.values(value).forEach(canonicalKeys);
        }
      }
      canonicalKeys(query);
      expect(f.rows('trust').map((row) => row.fence)).toEqual([1, 1, 1, 1]);
    },
  );
  it.each(['missing-request', 'missing-provenance', 'extra-field', 'null-evidence'])(
    'rejects %s registration before any consumption transaction',
    async (kind) => {
      const f = fixture(),
        c = await f.seed(),
        input = consentDataCopy(c);
      if (kind === 'missing-request') Reflect.deleteProperty(input, 'request');
      if (kind === 'missing-provenance')
        Reflect.deleteProperty(input.evidence.person, 'provenance');
      if (kind === 'extra-field') Object.assign(input.evidence.challenge, { verified: true });
      if (kind === 'null-evidence') Object.assign(input, { evidence: null });
      const sessions = f.sessions.length;
      await expect(f.repo.consume(input)).rejects.toMatchObject({ status: 400 });
      const { consumptionId, ...registration } = input;
      void consumptionId;
      await expect(f.repo.registerSynthetic(registration)).rejects.toMatchObject({
        status: 400,
      });
      expect(f.sessions).toHaveLength(sessions);
      expect(f.rows('trust').every((row) => row.fence === 0)).toBe(true);
      expect(f.rows('receipts')).toHaveLength(0);
      expect(f.rows('audits')).toHaveLength(0);
    },
  );
  it.each(['REQUEST', 'DECLINE'] as const)(
    'consumes exact %s context with one receipt and attributed audit',
    async (action) => {
      const f = fixture(),
        c = await f.seed(intentFixture({ action }));
      expect(await f.repo.consume(c)).toEqual({
        outcome: 'CONFIRMED',
        consumptionId: c.consumptionId,
        verificationAttemptId: c.request.verificationAttemptId,
        challengeId: c.evidence.challenge.challengeId,
      });
      expect(f.rows('challenges')[0]).toMatchObject({
        state: 'CONSUMED',
        revision: 1,
        consumptionId: c.consumptionId,
      });
      expect(f.rows('receipts')).toHaveLength(1);
      expect(f.rows('audits')).toHaveLength(1);
      expect(f.rows('audits')[0]).toMatchObject({
        resourceId: c.consumptionId,
        action: 'CUSTOMER_CONSENT_INTENT_CONSUMED',
        metadata: {
          challengeId: c.evidence.challenge.challengeId,
          proofId: c.request.source!.evidenceId,
          consentAction: action,
          state: 'CONSUMED',
          ticketId: c.request.ticket.ticketId,
          episodeId: c.request.ticket.episodeId,
        },
      });
      expect(f.rows('audits')[0].actorUserId).toEqual(new Types.ObjectId(c.request.actorUserId));
      expect(await f.repo.reconcile(intentReconciliation(c))).toMatchObject({
        outcome: 'CONFIRMED',
        status: 'COMMITTED',
        operationalAccess: false,
      });
      expect(JSON.stringify(f.rows('audits'))).not.toContain('issuerSubject');
      expect(JSON.stringify(f.rows('receipts'))).not.toContain('VERIFIED_GRANTED');
    },
  );
  it('rejects same challenge twice and verifies already-consumed evidence without new success', async () => {
    const f = fixture(),
      c = await f.seed();
    await f.repo.consume(c);
    const duplicate = { ...c, consumptionId: randomUUID() };
    expect((await f.repo.consume(duplicate)).outcome).toBe('REJECTED');
    expect(await f.repo.reconcile(intentReconciliation(duplicate))).toMatchObject({
      outcome: 'REJECTED',
      status: 'ALREADY_CONSUMED',
    });
    expect(f.rows('receipts')).toHaveLength(1);
    expect(f.rows('audits')).toHaveLength(1);
  });
  it.each(['another-challenge', 'another-action', 'another-Organisation', 'new-proof-revision'])(
    'enforces globally unique proof identity across %s',
    async (kind) => {
      const f = fixture(),
        a = await f.seed();
      await f.repo.consume(a);
      const b = await f.seed(
        intentFixture({
          proofId: a.request.source!.evidenceId,
          action: kind === 'another-action' ? 'DECLINE' : 'REQUEST',
          organizationId:
            kind === 'another-Organisation' ? consentIds.foreignOrganization : undefined,
          proofRevision: kind === 'new-proof-revision' ? 'r2' : undefined,
        }),
      );
      expect((await f.repo.consume(b)).outcome).toBe('REJECTED');
      expect(f.rows('receipts')).toHaveLength(1);
      expect(f.rows('audits')).toHaveLength(1);
      expect(
        f.rows('challenges').find((r) => r._id === b.evidence.challenge.challengeId),
      ).toMatchObject({ state: 'ISSUED', revision: 0 });
      if (kind !== 'another-Organisation')
        expect(await f.repo.reconcile(intentReconciliation(b))).toMatchObject({
          status: 'ALREADY_CONSUMED',
          outcome: 'REJECTED',
        });
      else
        expect(await f.repo.reconcile(intentReconciliation(b))).toMatchObject({
          status: 'ABSENT_UNCERTAIN',
          outcome: 'UNCONFIRMED',
        });
    },
  );
  it('rejects duplicate challenge/nonce registration without overwriting trust or binding', async () => {
    const f = fixture(),
      a = await f.seed();
    expect(await f.repo.registerSynthetic(intentRegistration(a))).toBe('CONFLICT');
    const b = intentFixture({ nonceSha256: a.evidence.challenge.nonceSha256 });
    expect(await f.repo.registerSynthetic(intentRegistration(b))).toBe('CONFLICT');
    expect(f.rows('challenges')).toHaveLength(1);
  });
  it.each([
    'actor',
    'Organisation',
    'Ticket',
    'episode',
    'purpose',
    'action',
    'attempt',
    'source',
    'policy',
    'person',
    'person-version',
    'Owner-version',
    'credential-version',
    'proof-version',
    'Consent',
    'ticket-revision',
    'nonce',
    'challenge',
    'channel-version',
  ])('rejects a consistently rebound but unregistered %s', async (field) => {
    const f = fixture(),
      original = await f.seed();
    const changed = consentDataCopy(original),
      r = changed.request,
      e = changed.evidence;
    if (field === 'actor') {
      Object.assign(r, { actorUserId: consentIds.beneficiary });
      Object.assign(e.person, { accountId: consentIds.beneficiary });
    }
    if (field === 'Organisation') {
      Object.assign(r.ticket, { organizationId: consentIds.foreignOrganization });
      Object.assign(e.organisationAuthority, { organizationId: consentIds.foreignOrganization });
    }
    if (field === 'Ticket') Object.assign(r.ticket, { ticketId: randomUUID() });
    if (field === 'episode') Object.assign(r.ticket, { episodeId: randomUUID() });
    if (field === 'purpose') {
      Object.assign(r.scope, { purposeId: 'other-purpose' });
      Object.assign(r.proposal!.scope, { purposeId: 'other-purpose' });
    }
    if (field === 'action') {
      Object.assign(r, { action: 'DECLINE', proposal: null, expectedConsentRevision: 0 });
      Object.assign(e, {
        originalGrantor: { personId: e.person.personId, accountId: e.person.accountId },
      });
    }
    if (field === 'attempt') Object.assign(r, { verificationAttemptId: randomUUID() });
    if (field === 'source') {
      Object.assign(r.source!, { evidenceId: randomUUID() });
      Object.assign(e.intent.provenance, r.source);
    }
    if (field === 'policy') {
      Object.assign(changed.policy.reference, { generation: 'new' });
      Object.assign(e.challenge.policy, { generation: 'new' });
    }
    if (field === 'person') Object.assign(e.person, { personId: 'another-synthetic-person' });
    if (field === 'person-version') Object.assign(e.person.provenance, { generation: 'new' });
    if (field === 'Owner-version')
      Object.assign(e.organisationAuthority.provenance, { generation: 'new' });
    if (field === 'credential-version') Object.assign(e.intent.credential, { generation: 'new' });
    if (field === 'proof-version') {
      Object.assign(r.source!, { generation: 'new' });
      Object.assign(e.intent.provenance, r.source);
    }
    if (field === 'Consent') Object.assign(r, { consentId: randomUUID() });
    if (field === 'ticket-revision') Object.assign(r, { ticketRevision: 1 });
    if (field === 'nonce') {
      Object.assign(e.challenge, { nonceSha256: 'f'.repeat(64) });
      Object.assign(e.intent, { nonceSha256: e.challenge.nonceSha256 });
    }
    if (field === 'challenge') {
      Object.assign(e.challenge, { challengeId: randomUUID() });
      Object.assign(e.intent, { challengeId: e.challenge.challengeId });
    }
    if (field === 'channel-version')
      Object.assign(changed.policy.channel.configuration, { generation: 'new' });
    const { verificationAttemptId, ...binding } = r;
    void verificationAttemptId;
    const { issuerSubject, ...person } = e.person;
    void issuerSubject;
    Object.assign(e, { request: consentDataCopy(r) });
    Object.assign(e.organisationAuthority, { person: consentDataCopy(person) });
    Object.assign(e.challenge, {
      request: consentDataCopy(binding),
      person: consentDataCopy(person),
      channel: consentDataCopy(changed.policy.channel),
    });
    Object.assign(e.intent, {
      request: consentDataCopy(binding),
      person: consentDataCopy(person),
      channel: consentDataCopy(changed.policy.channel),
    });
    const { status, ...authority } = e.organisationAuthority.provenance;
    void status;
    Object.assign(e.challenge, { organisationAuthority: consentDataCopy(authority) });
    Object.assign(e.intent, { organisationAuthority: consentDataCopy(authority) });
    // Both are fully valid E5A envelopes; only the durable registered context is authoritative locally.
    expect(() => captureIntentConsumption(changed, Date.now())).not.toThrow();
    expect((await f.repo.consume(changed)).outcome).toBe('REJECTED');
    expect(f.rows('receipts')).toHaveLength(0);
    expect(f.rows('audits')).toHaveLength(0);
  });
  it.each(['revision', 'state', 'hash', 'extra-field', 'binding'])(
    'rejects corrupt stored challenge %s without audit',
    async (kind) => {
      const f = fixture(),
        c = await f.seed(),
        row = f.rows('challenges')[0];
      if (kind === 'revision') row.revision = 2;
      if (kind === 'state') row.state = 'VERIFIED_GRANTED';
      if (kind === 'hash') row.contextHash = '0'.repeat(64);
      if (kind === 'extra-field') row.verified = true;
      if (kind === 'binding')
        Object.assign((row.registration as ReturnType<typeof intentRegistration>).request.ticket, {
          ticketId: randomUUID(),
        });
      await expect(f.repo.consume(c)).rejects.toMatchObject({
        status: 503,
        response: { code: 'CONSENT_INTENT_SNAPSHOT_INVALID' },
      });
      expect(f.rows('audits')).toHaveLength(0);
    },
  );
  it.each(['revoked', 'missing', 'corrupt', 'new-version'])(
    'rejects %s local synthetic trust',
    async (kind) => {
      const f = fixture(),
        c = await f.seed(),
        row = f.rows('trust')[0];
      if (kind === 'revoked') row.state = 'REVOKED';
      if (kind === 'missing') f.collections.trust.findOne.mockResolvedValueOnce(null);
      if (kind === 'corrupt') row.payloadHash = 'bad';
      if (kind === 'new-version') {
        const p = row.payload as typeof c.policy;
        Object.assign(p.reference, { revision: 'new' });
        row.reference = { ...(row.reference as object), revision: 'new' };
        row.payloadHash = intentHash(p);
      }
      if (kind === 'corrupt')
        await expect(f.repo.consume(c)).rejects.toMatchObject({ status: 503 });
      else expect((await f.repo.consume(c)).outcome).toBe('REJECTED');
      expect(f.rows('receipts')).toHaveLength(0);
      expect(f.rows('audits')).toHaveLength(0);
    },
  );
  it.each(['missing', 'nonunique', 'partial', 'sparse', 'collation', 'TTL'])(
    'fails closed on %s required indexes',
    async (kind) => {
      const f = fixture(),
        c = intentFixture();
      const original = await f.collections.receipts.indexes();
      const altered = intentBsonCopy(original),
        target = altered[1];
      if (kind === 'missing') altered.splice(1, 1);
      if (kind === 'nonunique') target.unique = false;
      if (kind === 'partial') target.partialFilterExpression = { state: 'CONSUMED' };
      if (kind === 'sparse') target.sparse = true;
      if (kind === 'collation') target.collation = { locale: 'en' };
      if (kind === 'TTL')
        altered.push({ name: 'dangerous_ttl', key: { registeredAtMs: 1 }, expireAfterSeconds: 1 });
      f.collections.receipts.indexes.mockResolvedValue(altered);
      await expect(f.repo.consume(c)).rejects.toMatchObject({
        status: 503,
        response: { code: 'CONSENT_INTENT_INDEX_REQUIRED' },
      });
      expect(f.sessions).toHaveLength(0);
    },
  );
  it('requires transaction support and same-connection audit', async () => {
    const f = fixture();
    f.hello.mockResolvedValue({} as { setName: string });
    await expect(f.repo.consume(intentFixture())).rejects.toMatchObject({
      status: 503,
      response: { code: 'MONGO_TRANSACTIONS_REQUIRED' },
    });
    expect(
      () =>
        new MongoConsentIntentConsumption(
          { ...f.models, audits: { ...f.models.audits, db: {} as Connection } },
          f.audit,
        ),
    ).toThrow('one connection');
  });
  it('requires the dedicated audit identity index as well as proof indexes', async () => {
    const f = fixture();
    f.collections.audits.indexes.mockResolvedValue([{ name: '_id_', key: { _id: 1 } }]);
    await expect(f.repo.consume(intentFixture())).rejects.toMatchObject({
      status: 503,
      response: { code: 'CONSENT_INTENT_INDEX_REQUIRED' },
    });
    expect(f.sessions).toHaveLength(0);
  });
  it('rejects a valid revoked challenge state and a different expected Consent revision', async () => {
    const f = fixture(),
      c = await f.seed(intentFixture({ action: 'DECLINE' }));
    f.rows('challenges')[0].state = 'REVOKED';
    expect((await f.repo.consume(c)).outcome).toBe('REJECTED');
    f.rows('challenges')[0].state = 'ISSUED';
    const changed = consentDataCopy(c);
    Object.assign(changed.request, { expectedConsentRevision: 1 });
    Object.assign(changed.evidence.request, { expectedConsentRevision: 1 });
    Object.assign(changed.evidence.challenge.request, { expectedConsentRevision: 1 });
    Object.assign(changed.evidence.intent.request, { expectedConsentRevision: 1 });
    expect((await f.repo.consume(changed)).outcome).toBe('REJECTED');
    expect(f.rows('audits')).toHaveLength(0);
  });
  it('rejects expiry during storage waits and rolls back local trust fences', async () => {
    const f = fixture(),
      c = await f.seed(),
      update = f.collections.trust.updateOne.getMockImplementation()!;
    f.collections.trust.updateOne.mockImplementationOnce(async (...args) => {
      const value = await update(...args);
      jest.spyOn(Date, 'now').mockReturnValue(c.evidence.challenge.expiresAtMs);
      return value;
    });
    expect((await f.repo.consume(c)).outcome).toBe('REJECTED');
    expect(f.rows('trust').every((row) => row.fence === 0)).toBe(true);
    expect(f.rows('audits')).toHaveLength(0);
  });
  it.each(['audit-error', 'audit-not-written', 'receipt-error', 'unacknowledged-write'])(
    'rolls back %s with no orphan receipt/audit',
    async (kind) => {
      const f = fixture(),
        c = await f.seed();
      if (kind === 'audit-error') f.control.auditError = Error('private audit failure');
      if (kind === 'audit-not-written') f.append.mockResolvedValueOnce(undefined);
      if (kind === 'receipt-error')
        f.control.insertError = { name: 'receipts', error: Error('private receipt failure') };
      if (kind === 'unacknowledged-write') f.control.acknowledged = false;
      if (kind === 'unacknowledged-write')
        expect((await f.repo.consume(c)).outcome).toBe('UNCONFIRMED');
      else await expect(f.repo.consume(c)).rejects.toMatchObject({ status: 503 });
      expect(f.rows('challenges')[0]).toMatchObject({ state: 'ISSUED', revision: 0 });
      expect(f.rows('receipts')).toHaveLength(0);
      expect(f.rows('audits')).toHaveLength(0);
      expect(f.sessions.at(-1)!.abortTransaction).toHaveBeenCalledTimes(1);
    },
  );
  it.each([false, true])(
    'preserves unknown commit with fixture durable persistence=%s and no replay',
    async (persisted) => {
      const f = fixture(),
        c = await f.seed();
      f.control.persistCommitError = persisted;
      f.control.commitError = new mongo.MongoServerError({
        message: 'private acknowledgement loss',
        code: 50,
        errorLabels: ['UnknownTransactionCommitResult', 'TransientTransactionError'],
      });
      const before = f.append.mock.calls.length;
      expect(await f.repo.consume(c)).toMatchObject({
        outcome: 'UNCONFIRMED',
        consumptionId: c.consumptionId,
      });
      expect(f.append.mock.calls.length - before).toBe(1);
      const s = f.sessions.at(-1)!;
      expect(s.commitTransaction).toHaveBeenCalledTimes(1);
      expect(s.withTransaction).not.toHaveBeenCalled();
      f.control.commitError = undefined;
      expect(await f.repo.reconcile(intentReconciliation(c))).toMatchObject({
        status: persisted ? 'COMMITTED' : 'ABSENT_UNCERTAIN',
        outcome: persisted ? 'CONFIRMED' : 'UNCONFIRMED',
      });
      expect(f.append.mock.calls.length - before).toBe(1);
    },
  );
  it('keeps cleanup errors from masking a primary audit failure', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const f = fixture(),
      c = await f.seed();
    f.control.auditError = Error('private primary');
    f.control.abortError = Error('private abort');
    f.control.endError = Error('private cleanup');
    const error = await f.repo.consume(c).catch((e: unknown) => e);
    expect(error).toMatchObject({
      status: 503,
      response: { code: 'CONSENT_INTENT_TRANSACTION_ABORTED' },
    });
    expect(JSON.stringify(error)).not.toMatch(/private primary|private abort|private cleanup/);
  });
  it('models distinct concurrent sessions with one consumption winner', async () => {
    const f = fixture(),
      c = await f.seed();
    const results = await Promise.all([
      f.repo.consume(c),
      f.repo.consume({ ...c, consumptionId: randomUUID() }),
    ]);
    expect(results.map((r) => r.outcome).sort()).toEqual(['CONFIRMED', 'REJECTED']);
    expect(new Set(f.sessions.slice(-2)).size).toBe(2);
    expect(f.rows('receipts')).toHaveLength(1);
    expect(f.rows('audits')).toHaveLength(1);
  });
  it.each([
    'receipt-missing',
    'audit-missing',
    'audit-mismatch',
    'receipt-mismatch',
    'challenge-mismatch',
  ])('never confirms reconciliation with %s evidence', async (kind) => {
    const f = fixture(),
      c = await f.seed();
    await f.repo.consume(c);
    if (kind === 'receipt-missing') f.collections.receipts.findOne.mockResolvedValue(null);
    if (kind === 'audit-missing')
      f.collections.audits.find.mockReturnValue({
        limit() {
          return this;
        },
        toArray: async () => [],
      });
    if (kind === 'audit-mismatch') f.rows('audits')[0].action = 'FORGED';
    if (kind === 'receipt-mismatch') f.rows('receipts')[0].contextHash = 'forged';
    if (kind === 'challenge-mismatch') f.rows('challenges')[0].consumptionId = randomUUID();
    expect(await f.repo.reconcile(intentReconciliation(c))).toMatchObject({
      outcome: 'UNCONFIRMED',
      status: 'EVIDENCE_INCONSISTENT',
    });
  });
  it('returns scoped uncertainty for absent receipts, never retries, and denies foreign scope', async () => {
    const f = fixture(),
      c = await f.seed();
    expect(await f.repo.reconcile(intentReconciliation(c))).toMatchObject({
      status: 'ABSENT_UNCERTAIN',
      outcome: 'UNCONFIRMED',
    });
    expect(f.collections.challenges.updateOne).not.toHaveBeenCalled();
    const foreign = intentReconciliation(c);
    Object.assign(foreign.request.ticket, { organizationId: consentIds.foreignOrganization });
    await expect(f.repo.reconcile(foreign)).rejects.toMatchObject({ status: 403 });
  });
  it('reconciles historical consumption after challenge expiry without treating it as new authority', async () => {
    const f = fixture(),
      c = await f.seed();
    await f.repo.consume(c);
    jest.spyOn(Date, 'now').mockReturnValue(c.evidence.challenge.expiresAtMs + 1);
    expect(await f.repo.reconcile(intentReconciliation(c))).toMatchObject({
      status: 'COMMITTED',
      operationalAccess: false,
    });
  });
  it('distinguishes unavailable reconciliation storage from inconsistent evidence', async () => {
    const f = fixture(),
      c = await f.seed();
    await f.repo.consume(c);
    f.collections.audits.find.mockImplementationOnce(() => {
      throw Error('private read outage');
    });
    expect(await f.repo.reconcile(intentReconciliation(c))).toMatchObject({
      status: 'EVIDENCE_UNAVAILABLE',
      outcome: 'UNCONFIRMED',
    });
  });
  it('rejects duplicate audit evidence and an incorrect audit pointer', async () => {
    const f = fixture(),
      c = await f.seed();
    await f.repo.consume(c);
    const entry = intentBsonCopy(f.rows('audits')[0]);
    f.collections.audits.find.mockReturnValueOnce({
      limit() {
        return this;
      },
      toArray: async () => [entry, { ...entry, _id: new Types.ObjectId() }],
    });
    expect(await f.repo.reconcile(intentReconciliation(c))).toMatchObject({
      status: 'EVIDENCE_INCONSISTENT',
      outcome: 'UNCONFIRMED',
    });
    f.rows('receipts')[0].auditId = new Types.ObjectId();
    expect(await f.repo.reconcile(intentReconciliation(c))).toMatchObject({
      status: 'EVIDENCE_INCONSISTENT',
      outcome: 'UNCONFIRMED',
    });
  });
  it('detaches commands before index waits and returns no mutable trusted evidence', async () => {
    const f = fixture(),
      c = await f.seed();
    let finish!: (r: Row[]) => void;
    const indexes = await f.collections.challenges.indexes();
    f.collections.challenges.indexes.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const operation = f.repo.consume(c);
    expect(finish).toBeDefined();
    Object.assign(c.request, { actorUserId: consentIds.beneficiary });
    finish(indexes);
    expect(await operation).toMatchObject({ outcome: 'CONFIRMED' });
  });
  it.each(['challenge', 'receipt'])(
    'raw %s mapper rejects getters without executing them',
    async (kind) => {
      const f = fixture(),
        c = await f.seed();
      await f.repo.consume(c);
      const raw = intentBsonCopy(f.rows(kind === 'challenge' ? 'challenges' : 'receipts')[0]);
      let reads = 0;
      Object.defineProperty(raw, 'registration', {
        get() {
          reads++;
          throw Error('private getter');
        },
        enumerable: true,
      });
      expect(() =>
        kind === 'challenge' ? intentChallengeFromSnapshot(raw) : intentReceiptFromSnapshot(raw),
      ).toThrow();
      expect(reads).toBe(0);
    },
  );
  it('rejects positive grants, extra trusted flags and malicious cyclic command data', async () => {
    const f = fixture();
    for (const kind of ['GRANT', 'verified', 'cycle']) {
      const c = intentFixture();
      if (kind === 'GRANT') Object.assign(c.request, { action: 'GRANT' });
      else Object.assign(c, { [kind]: kind === 'cycle' ? c : true });
      await expect(f.repo.consume(c)).rejects.toMatchObject({ status: 400 });
    }
    expect(f.sessions).toHaveLength(0);
  });
});
