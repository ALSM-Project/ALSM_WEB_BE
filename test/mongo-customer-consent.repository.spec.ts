import { Logger } from '@nestjs/common';
import { Model, Types, mongo } from 'mongoose';
import { CustomerConsentEntity } from '../src/modules/support/domain/customer-consent.entity';
import type { CustomerConsentAudit } from '../src/modules/support/domain/customer-consent.repository';
import { writeCustomerConsent } from '../src/modules/support/application/customer-consent-write';
import {
  customerConsentScope,
  customerConsentToSnapshot,
} from '../src/modules/support/infrastructure/customer-consent.mapper';
import { MongoCustomerConsentRepository } from '../src/modules/support/infrastructure/mongo-customer-consent.repository';
import {
  CUSTOMER_CONSENT_SOURCE_INDEX,
  CUSTOMER_CONSENT_SOURCE_INDEX_NAME,
  CustomerConsentSnapshot,
} from '../src/modules/support/infrastructure/customer-consent.schema';
import { consentIds } from './customer-consent.fixtures';
import {
  consentAuditFixture,
  negativeConsentFixture,
  persistedConsentFixture,
} from './customer-consent.persistence.fixtures';

function bsonCopy<T>(value: T): T {
  if (value instanceof Types.ObjectId) return new Types.ObjectId(value.toHexString()) as T;
  if (value instanceof Date) return new Date(value) as T;
  if (Array.isArray(value)) return value.map(bsonCopy) as T;
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, bsonCopy(child)]),
    ) as T;
  return value;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { resolve, promise };
}

/** A staged fixture for orchestration, never evidence of database atomicity. */
function fixture(initial: CustomerConsentEntity | null = persistedConsentFixture()) {
  let committed = initial && customerConsentToSnapshot(initial),
    staged = bsonCopy(committed);
  let committedAudit: CustomerConsentAudit[] = [],
    stagedAudit: CustomerConsentAudit[] = [];
  let active = false;
  const control = {
    commitError: undefined as unknown,
    auditError: undefined as unknown,
    insertError: undefined as unknown,
    updateError: undefined as unknown,
    abortError: undefined as unknown,
    endError: undefined as unknown,
    persistCommitError: true,
    acknowledged: true,
    modifiedCount: 1,
  };
  const session = {
    explicit: true,
    hasEnded: false,
    transaction: { state: 'NO_TRANSACTION' },
    inTransaction: () => active,
    startTransaction: jest.fn(() => {
      active = true;
      staged = bsonCopy(committed);
      stagedAudit = bsonCopy(committedAudit);
      session.transaction = { state: 'TRANSACTION_IN_PROGRESS' };
    }),
    commitTransaction: jest.fn(async () => {
      const error = control.commitError;
      if (!error || control.persistCommitError) {
        committed = bsonCopy(staged);
        committedAudit = bsonCopy(stagedAudit);
      }
      active = false;
      session.transaction.state = 'TRANSACTION_COMMITTED';
      if (error) throw error;
    }),
    abortTransaction: jest.fn(async () => {
      active = false;
      session.transaction.state = 'TRANSACTION_ABORTED';
      if (control.abortError) throw control.abortError;
    }),
    endSession: jest.fn(async () => {
      if (control.endError) throw control.endError;
    }),
    withTransaction: jest.fn(async () => {
      throw new Error('Business replay helper is forbidden');
    }),
  };
  const audit = {
    append: jest.fn(async (entry: CustomerConsentAudit) => {
      if (control.auditError) throw control.auditError;
      stagedAudit.push(bsonCopy(entry));
    }),
  };
  function matches(value: CustomerConsentSnapshot | null, filter: Record<string, unknown>) {
    return (
      !!value &&
      Object.entries(filter).every(([key, expected]) => {
        const actual = value[key as keyof CustomerConsentSnapshot];
        return expected instanceof Types.ObjectId
          ? expected.equals(actual as Types.ObjectId)
          : actual === expected;
      })
    );
  }
  const native = {
    indexes: jest.fn().mockResolvedValue([
      {
        name: CUSTOMER_CONSENT_SOURCE_INDEX_NAME,
        key: CUSTOMER_CONSENT_SOURCE_INDEX,
        unique: true,
        collation: { locale: 'simple' },
      },
    ]),
    insertOne: jest.fn(async (snapshot: CustomerConsentSnapshot) => {
      if (control.insertError) throw control.insertError;
      if (staged) throw Object.assign(new Error('duplicate fixture'), { code: 11000 });
      staged = bsonCopy(snapshot);
      return { acknowledged: control.acknowledged, insertedId: snapshot._id };
    }),
    updateOne: jest.fn(
      async (
        filter: Record<string, unknown>,
        update: { $set: Partial<CustomerConsentSnapshot> },
      ) => {
        if (control.updateError) throw control.updateError;
        if (!matches(staged, filter))
          return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
        staged = { ...staged!, ...bsonCopy(update.$set) };
        return {
          acknowledged: control.acknowledged,
          matchedCount: 1,
          modifiedCount: control.modifiedCount,
        };
      },
    ),
  };
  const connection = {
    db: { admin: () => ({ command: jest.fn().mockResolvedValue({ setName: 'owned-fixture' }) }) },
    startSession: jest.fn().mockResolvedValue(session),
    collection: jest.fn(() => native),
    transaction: jest.fn(),
  };
  const model = {
    db: connection,
    collection: { name: 'customer_consents' },
    findOne: jest.fn((filter: Record<string, unknown>) => {
      let selectedSession = false;
      const query = {
        session: jest.fn(),
        lean: jest.fn(),
        exec: jest.fn(async () => {
          const value = selectedSession ? staged : committed;
          return matches(value, filter) ? bsonCopy(value) : null;
        }),
      };
      query.session.mockImplementation(() => {
        selectedSession = true;
        return query;
      });
      query.lean.mockReturnValue(query);
      return query;
    }),
  };
  const factory = jest.fn((chosenSession, chosenConnection) => {
    expect(chosenSession).toBe(session);
    expect(chosenConnection).toBe(connection);
    expect(session.inTransaction()).toBe(true);
    return audit;
  });
  return {
    initial,
    control,
    session,
    model,
    native,
    audit,
    factory,
    connection,
    repo: new MongoCustomerConsentRepository(
      model as unknown as Model<CustomerConsentSnapshot>,
      factory,
    ),
    committed: () => bsonCopy(committed),
    audits: () => bsonCopy(committedAudit),
  };
}

describe('Mongo Customer Consent repository, synthetic transaction outcomes', () => {
  beforeEach(() => jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());
  it('requires a transaction-bound audit factory', () => {
    expect(() => new MongoCustomerConsentRepository({} as never, undefined as never)).toThrow(
      'transaction-bound audit factory',
    );
  });
  it('creates once with exact BSON, strict Core API and matching session/connection audit', async () => {
    const f = fixture(null),
      pending = persistedConsentFixture(),
      p = pending.toProps();
    expect(await f.repo.create(pending, consentAuditFixture(pending))).toBe('CONFIRMED');
    expect(f.committed()).toEqual(customerConsentToSnapshot(pending));
    expect(f.audits()).toEqual([consentAuditFixture(pending)]);
    expect(f.native.insertOne).toHaveBeenCalledWith(customerConsentToSnapshot(pending), {
      session: f.session,
    });
    expect(f.session.startTransaction).toHaveBeenCalledWith({
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' },
      readPreference: 'primary',
      maxCommitTimeMS: 10000,
    });
    expect(f.session.commitTransaction).toHaveBeenCalledTimes(1);
    expect(f.session.withTransaction).not.toHaveBeenCalled();
    expect(f.connection.transaction).not.toHaveBeenCalled();
    expect(f.audits()[0]).toMatchObject({
      resourceId: p.consentId,
      actorUserId: p.createdByUserId,
      organizationId: p.organizationId,
    });
  });
  it.each(['DECLINE', 'INVALIDATE'] as const)(
    'CAS saves only %s lifecycle fields with correctly attributed audit',
    async (action) => {
      const f = fixture(),
        next = negativeConsentFixture(f.initial!, action);
      expect(await f.repo.save(next, 0, consentAuditFixture(next, 0))).toBe('CONFIRMED');
      expect(f.native.updateOne.mock.calls[0][0]).toEqual({
        ...customerConsentScope(
          next.toProps().consentId,
          consentIds.organization,
          consentIds.ticket,
        ),
        episodeId: next.toProps().episodeId,
        revision: 0,
        state: 'PENDING_VERIFICATION',
      });
      expect(Object.keys(f.native.updateOne.mock.calls[0][1].$set).sort()).toEqual(
        ['state', 'revision', 'updatedAt', 'updatedByUserId', 'history'].sort(),
      );
      expect(f.committed()).toEqual(customerConsentToSnapshot(next));
      expect(f.audits()).toEqual([consentAuditFixture(next, 0)]);
    },
  );
  it('scopes reads by Consent ID, Organisation and Ticket, returning null for foreign scope', async () => {
    const f = fixture(),
      p = f.initial!.toProps();
    expect((await f.repo.findById(p.consentId, p.organizationId, p.ticketId))?.toProps()).toEqual(
      p,
    );
    expect(
      await f.repo.findById(p.consentId, consentIds.foreignOrganization, p.ticketId),
    ).toBeNull();
    expect(await f.repo.findById(p.consentId, p.organizationId, consentIds.nextEpisode)).toBeNull();
  });
  it.each([
    'scope',
    'purpose',
    'grantor',
    'beneficiary',
    'policy',
    'authority',
    'requestSource',
    'createdAt',
  ] as const)('rejects a self-consistent rewrite of immutable %s', async (field) => {
    const f = fixture(),
      p = negativeConsentFixture(f.initial!).toProps();
    if (field === 'scope') Object.assign(p.scope, { projectionId: 'rewritten' });
    if (field === 'purpose') {
      Object.assign(p, { purposeId: 'rewritten' });
      Object.assign(p.scope, { purposeId: 'rewritten' });
    }
    if (field === 'grantor') Object.assign(p.grantor, { personId: 'rewritten' });
    if (field === 'beneficiary') {
      Object.assign(p.beneficiary.identity, { personId: 'rewritten' });
      Object.assign(p.coverage, { personId: 'rewritten' });
    }
    if (field === 'policy') Object.assign(p.policy, { version: 'rewritten' });
    if (field === 'authority')
      Object.assign(p.customerAuthority.evidence, { generation: 'rewritten' });
    if (field === 'requestSource') {
      Object.assign(p.requestSource, { evidenceId: 'rewritten' });
      Object.assign(p.history[0].source, { evidenceId: 'rewritten' });
    }
    if (field === 'createdAt') {
      p.createdAt.setTime(p.createdAt.getTime() - 1000);
      p.history[0].at.setTime(p.createdAt.getTime());
    }
    const next = CustomerConsentEntity.fromPersistence(p);
    await expect(f.repo.save(next, 0, consentAuditFixture(next, 0))).rejects.toMatchObject({
      status: 409,
    });
    expect(f.native.updateOne).not.toHaveBeenCalled();
    expect(f.audits()).toEqual([]);
    expect(f.session.commitTransaction).not.toHaveBeenCalled();
  });
  it.each(['organization', 'ticket', 'episode'] as const)(
    'does not modify an existing identity through a different %s scope',
    async (field) => {
      const f = fixture(),
        p = negativeConsentFixture(f.initial!).toProps();
      if (field === 'organization') {
        Object.assign(p, { organizationId: consentIds.foreignOrganization });
        Object.assign(p.customerAuthority, { organizationId: consentIds.foreignOrganization });
      }
      if (field === 'ticket') Object.assign(p, { ticketId: consentIds.nextEpisode });
      if (field === 'episode') Object.assign(p, { episodeId: consentIds.nextEpisode });
      const next = CustomerConsentEntity.fromPersistence(p);
      expect(await f.repo.save(next, 0, consentAuditFixture(next, 0))).toBe('CONFLICT');
      expect(f.native.updateOne).not.toHaveBeenCalled();
      expect(f.audits()).toEqual([]);
    },
  );
  it('rejects terminal insert/restore and stale revisions without an audit', async () => {
    const f = fixture(),
      terminal = negativeConsentFixture(f.initial!);
    await expect(f.repo.create(terminal, consentAuditFixture(terminal))).rejects.toMatchObject({
      status: 409,
    });
    await expect(f.repo.save(terminal, 1, consentAuditFixture(terminal, 1))).rejects.toMatchObject({
      status: 409,
    });
    expect(await f.repo.save(terminal, 0, consentAuditFixture(terminal, 0))).toBe('CONFIRMED');
    expect(await f.repo.save(terminal, 0, consentAuditFixture(terminal, 0))).toBe('CONFLICT');
    await expect(
      f.repo.save(f.initial!, 1, consentAuditFixture(f.initial!, 1)),
    ).rejects.toMatchObject({ status: 409 });
    expect(f.audits()).toHaveLength(1);
  });
  it.each([
    'actorUserId',
    'organizationId',
    'action',
    'resourceType',
    'resourceId',
    'metadata',
  ] as const)('rejects forged audit %s before MongoDB access', async (field) => {
    const f = fixture(null),
      pending = persistedConsentFixture(),
      audit = consentAuditFixture(pending);
    Object.assign(audit, {
      [field]: field === 'metadata' ? { rawEvidence: 'not-allowed' } : 'forged',
    });
    await expect(f.repo.create(pending, audit)).rejects.toMatchObject({ status: 409 });
    expect(f.connection.startSession).not.toHaveBeenCalled();
    expect(f.native.insertOne).not.toHaveBeenCalled();
  });
  it.each(['absent', 'nonunique', 'partial', 'sparse', 'wrongkey'] as const)(
    'fails closed on %s required index',
    async (kind) => {
      const f = fixture(null),
        pending = persistedConsentFixture();
      const index = {
        name: CUSTOMER_CONSENT_SOURCE_INDEX_NAME,
        key: CUSTOMER_CONSENT_SOURCE_INDEX,
        unique: true,
      };
      if (kind === 'absent') f.native.indexes.mockResolvedValue([]);
      else
        f.native.indexes.mockResolvedValue([
          {
            ...index,
            ...(kind === 'nonunique'
              ? { unique: false }
              : kind === 'partial'
                ? { partialFilterExpression: { state: 'PENDING_VERIFICATION' } }
                : kind === 'sparse'
                  ? { sparse: true }
                  : { key: { organizationId: 1 } }),
          },
        ]);
      await expect(f.repo.create(pending, consentAuditFixture(pending))).rejects.toMatchObject({
        status: 503,
        response: { code: 'CUSTOMER_CONSENT_INDEX_REQUIRED' },
      });
      expect(f.connection.startSession).not.toHaveBeenCalled();
    },
  );
  it('fails closed on standalone topology', async () => {
    const f = fixture(null),
      pending = persistedConsentFixture();
    f.connection.db.admin = () => ({
      command: jest.fn().mockResolvedValue({ isWritablePrimary: true }),
    });
    await expect(f.repo.create(pending, consentAuditFixture(pending))).rejects.toMatchObject({
      status: 503,
      response: { code: 'MONGO_TRANSACTIONS_REQUIRED' },
    });
    expect(f.connection.startSession).not.toHaveBeenCalled();
  });
  it.each([11000, 112])(
    'returns conflict for known precommit MongoDB code %s without replay or audit',
    async (code) => {
      const f = fixture(null),
        pending = persistedConsentFixture();
      f.control.insertError = Object.assign(new Error('private'), { code });
      expect(await f.repo.create(pending, consentAuditFixture(pending))).toBe('CONFLICT');
      expect(f.session.abortTransaction).toHaveBeenCalledTimes(1);
      expect(f.session.commitTransaction).not.toHaveBeenCalled();
      expect(f.native.insertOne).toHaveBeenCalledTimes(1);
      expect(f.audits()).toEqual([]);
    },
  );
  it.each([false, true])(
    'retains unconfirmed commit with possible fixture persistence=%s, without retries',
    async (persistCommitError) => {
      const f = fixture(null),
        pending = persistedConsentFixture();
      f.control.persistCommitError = persistCommitError;
      f.control.commitError = new mongo.MongoServerError({
        message: 'private commit failure',
        code: 50,
        errorLabels: ['UnknownTransactionCommitResult', 'TransientTransactionError'],
      });
      expect(await f.repo.create(pending, consentAuditFixture(pending))).toBe('UNCONFIRMED');
      expect(f.native.insertOne).toHaveBeenCalledTimes(1);
      expect(f.audit.append).toHaveBeenCalledTimes(1);
      expect(f.connection.startSession).toHaveBeenCalledTimes(1);
      expect(f.session.startTransaction).toHaveBeenCalledTimes(1);
      expect(f.session.commitTransaction).toHaveBeenCalledTimes(1);
      expect(f.session.abortTransaction).not.toHaveBeenCalled();
      expect(f.session.withTransaction).not.toHaveBeenCalled();
      expect(f.audits()).toHaveLength(persistCommitError ? 1 : 0);
    },
  );
  it('preserves original reconciliation IDs through the accepted E1 write helper', async () => {
    const f = fixture(null),
      pending = persistedConsentFixture();
    f.control.commitError = new Error('private acknowledgement failure');
    await expect(
      writeCustomerConsent(pending, null, (audit) => f.repo.create(pending, audit)),
    ).rejects.toMatchObject({
      status: 503,
      response: {
        code: 'CUSTOMER_CONSENT_OUTCOME_UNCONFIRMED',
        details: [
          expect.objectContaining({
            consentId: pending.toProps().consentId,
            organizationId: consentIds.organization,
            ticketId: consentIds.ticket,
            episodeId: consentIds.episode,
            revision: 0,
            expectedRevision: null,
            retrySafe: false,
            mutationCommitted: 'unknown',
          }),
        ],
      },
    });
    expect(f.native.insertOne).toHaveBeenCalledTimes(1);
  });
  it('does not classify mixed unknown labels on a precommit duplicate as a safe conflict', async () => {
    const f = fixture(null),
      pending = persistedConsentFixture();
    f.control.insertError = new mongo.MongoServerError({
      message: 'private',
      code: 11000,
      errorLabels: ['UnknownTransactionCommitResult'],
    });
    expect(await f.repo.create(pending, consentAuditFixture(pending))).toBe('UNCONFIRMED');
    expect(f.native.insertOne).toHaveBeenCalledTimes(1);
  });
  it.each(['insert', 'audit'] as const)(
    'aborts a failed %s without committing either state or audit',
    async (stage) => {
      const f = fixture(null),
        pending = persistedConsentFixture(),
        primary = new Error('private primary failure');
      if (stage === 'insert') f.control.insertError = primary;
      else f.control.auditError = primary;
      f.control.abortError = new Error('cleanup failure');
      f.control.endError = new Error('cleanup failure');
      await expect(f.repo.create(pending, consentAuditFixture(pending))).rejects.toMatchObject({
        status: 503,
        cause: primary,
        response: {
          code: 'ATOMIC_MUTATION_ABORTED',
          details: [expect.objectContaining({ mutationCommitted: false, retrySafe: false })],
        },
      });
      expect(f.committed()).toBeNull();
      expect(f.audits()).toEqual([]);
      expect(f.session.commitTransaction).not.toHaveBeenCalled();
    },
  );
  it.each(['CONFIRMED', 'UNCONFIRMED'] as const)(
    'session cleanup failure cannot replace established %s',
    async (outcome) => {
      const f = fixture(null),
        pending = persistedConsentFixture();
      f.control.endError = new Error('cleanup failure');
      if (outcome === 'UNCONFIRMED') f.control.commitError = new Error('commit failure');
      expect(await f.repo.create(pending, consentAuditFixture(pending))).toBe(outcome);
    },
  );
  it('does not confirm unacknowledged or impossible write counts', async () => {
    const f = fixture(),
      next = negativeConsentFixture(f.initial!);
    f.control.modifiedCount = 0;
    expect(await f.repo.save(next, 0, consentAuditFixture(next, 0))).toBe('UNCONFIRMED');
    expect(f.session.commitTransaction).not.toHaveBeenCalled();
    expect(f.audits()).toEqual([]);
  });
  it('captures caller audit and entity data before the index/storage await', async () => {
    const f = fixture(null),
      pending = persistedConsentFixture(),
      audit = consentAuditFixture(pending),
      original = bsonCopy(audit);
    const gate = deferred<unknown[]>();
    f.native.indexes.mockReturnValueOnce(gate.promise);
    const operation = f.repo.create(pending, audit);
    Object.assign(audit, { actorUserId: consentIds.beneficiary });
    Object.assign(audit.metadata!, { sourceEventId: 'forged', rawEvidence: 'secret' });
    const copy = pending.toProps();
    Object.assign(copy.scope, { projectionId: 'forged' });
    copy.createdAt.setUTCFullYear(2000);
    gate.resolve([
      {
        name: CUSTOMER_CONSENT_SOURCE_INDEX_NAME,
        key: CUSTOMER_CONSENT_SOURCE_INDEX,
        unique: true,
      },
    ]);
    expect(await operation).toBe('CONFIRMED');
    expect(f.audits()).toEqual([original]);
    expect(f.committed()).toEqual(customerConsentToSnapshot(pending));
  });
});
