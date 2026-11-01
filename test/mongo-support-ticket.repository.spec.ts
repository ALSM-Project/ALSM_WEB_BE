import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { ClientSession, Model, Types, mongo } from 'mongoose';
import type { AuditRepository } from '../src/modules/audit/domain/audit.repository';
import { SupportTicketEntity } from '../src/modules/support/domain/support-ticket.entity';
import { MongoSupportTicketRepository } from '../src/modules/support/infrastructure/mongo-support-ticket.repository';
import { supportTicketToSnapshot } from '../src/modules/support/infrastructure/support-ticket.mapper';
import { SupportTicket } from '../src/modules/support/infrastructure/support-ticket.schema';
import {
  at,
  foreignId,
  historyTicket,
  newTicket,
  operatorId,
  organizationId,
  requesterId,
  retainedClaims,
} from './support-ticket.persistence.fixtures';

type AuditEntry = Parameters<AuditRepository['append']>[0];
/** Staging fixture tests orchestration only; it is NOT evidence of MongoDB transactions. */
function fixture(initial: SupportTicketEntity | null = newTicket()) {
  const clone = (value: unknown): unknown => {
    if (value instanceof Date) return new Date(value);
    if (value instanceof Types.ObjectId) return new Types.ObjectId(value.toHexString());
    if (Array.isArray(value)) return value.map(clone);
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
    return value;
  };
  const copy = (value: SupportTicket | null) => clone(value) as SupportTicket | null;
  let committed = initial && supportTicketToSnapshot(initial),
    staged = copy(committed);
  let committedAudit: AuditEntry[] = [],
    stagedAudit: AuditEntry[] = [];
  const control = { commitError: undefined as unknown, persistOnCommitError: true };
  let active = false;
  const session = {
    explicit: true,
    hasEnded: false,
    transaction: { state: 'NO_TRANSACTION' },
    timeoutMS: undefined,
    timeoutContext: null,
    inTransaction: () => active,
    startTransaction: jest.fn(() => {
      staged = copy(committed);
      stagedAudit = [...committedAudit];
      active = true;
      session.transaction = { state: 'TRANSACTION_IN_PROGRESS' };
    }),
    commitTransaction: jest.fn(async () => {
      const error = control.commitError;
      control.commitError = undefined;
      // Model either possible server outcome explicitly; the public error must
      // be identical. This fixture does not establish a real database outcome.
      if (!error || control.persistOnCommitError) {
        committed = copy(staged);
        committedAudit = [...stagedAudit];
      }
      active = false;
      session.transaction.state = 'TRANSACTION_COMMITTED';
      if (error) throw error;
    }),
    abortTransaction: jest.fn(async () => {
      active = false;
      session.transaction.state = 'TRANSACTION_ABORTED';
    }),
    withTransaction: jest.fn<Promise<unknown>, [() => Promise<unknown>, object]>(),
    endSession: jest.fn().mockResolvedValue(undefined),
  };
  // Retain the installed convenience algorithm as a regression trap: entering
  // it would reproduce the code-50 mixed-label callback replay. Fake transport
  // methods above exercise driver control flow only, never MongoDB concurrency.
  session.withTransaction.mockImplementation((work, options) =>
    mongo.ClientSession.prototype.withTransaction.call(
      session as unknown as ClientSession,
      work,
      options,
    ),
  );
  const audit = {
    append: jest.fn(async (entry: AuditEntry) => {
      stagedAudit.push(entry);
    }),
  };
  const auditFactory = jest.fn(() => audit);
  const writes = {
    insertOne: jest.fn(async (snapshot: SupportTicket) => {
      if (staged) throw Object.assign(new Error('duplicate fixture'), { code: 11000 });
      staged = copy(snapshot);
      return { acknowledged: true, insertedId: snapshot._id };
    }),
    updateOne: jest.fn(
      async (_filter: unknown, update: { $set: Partial<SupportTicket> }, options: unknown) => {
        expect(options).toMatchObject({ upsert: false });
        staged = staged && { ...staged, ...update.$set };
        return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
      },
    ),
  };
  const query = {
    session: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn(async () => (active ? staged : committed)),
  };
  const hello = jest.fn().mockResolvedValue({ setName: 'fixture-only' });
  const connection = {
    collection: jest.fn(() => writes),
    db: { admin: () => ({ command: hello }) },
    startSession: jest.fn().mockResolvedValue(session),
  };
  const model = {
    db: connection,
    collection: { name: 'support_tickets' },
    findOne: jest.fn().mockReturnValue(query),
  };
  return {
    repo: new MongoSupportTicketRepository(model as unknown as Model<SupportTicket>, auditFactory),
    model,
    query,
    writes,
    session,
    connection,
    hello,
    audit,
    auditFactory,
    control,
    stored: () => copy(committed),
    audits: () => [...committedAudit],
    corrupt: (value: SupportTicket) => {
      committed = value;
    },
  };
}

describe('Mongo Support Ticket adapter orchestration (mock-only)', () => {
  it('uses insert-only creation and the exact audit transaction, confirming commit before resolving', async () => {
    const f = fixture(null),
      ticket = newTicket();
    await f.repo.create(ticket);
    expect(f.writes.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: ticket.toProps().ticketId }),
      { session: f.session },
    );
    expect(f.writes.updateOne).not.toHaveBeenCalled();
    expect(f.auditFactory).toHaveBeenCalledWith(f.session, f.connection);
    expect(f.audits()).toEqual([
      expect.objectContaining({
        actorUserId: requesterId,
        organizationId,
        action: 'SUPPORT_TICKET_CREATED',
      }),
    ]);
    expect(f.stored()).toEqual(supportTicketToSnapshot(ticket));
    expect(f.session.startTransaction).toHaveBeenCalledWith({
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' },
      readPreference: 'primary',
      maxCommitTimeMS: 10000,
    });
    expect(f.session.startTransaction).toHaveBeenCalledTimes(1);
    expect(f.session.commitTransaction).toHaveBeenCalledTimes(1);
    expect(f.session.abortTransaction).not.toHaveBeenCalled();
    expect(f.session.withTransaction).not.toHaveBeenCalled();
    expect(f.session.endSession).toHaveBeenCalledTimes(1);
  });

  it('rejects duplicate Ticket creation without retrying, replacing data or appending audit', async () => {
    const ticket = newTicket(),
      f = fixture(ticket);
    await expect(f.repo.create(ticket)).rejects.toMatchObject({
      response: { code: 'SUPPORT_TICKET_ALREADY_EXISTS' },
    });
    expect(f.writes.insertOne).toHaveBeenCalledTimes(1);
    expect(f.session.startTransaction).toHaveBeenCalledTimes(1);
    expect(f.session.withTransaction).not.toHaveBeenCalled();
    expect(f.session.abortTransaction).toHaveBeenCalledTimes(1);
    expect(f.session.commitTransaction).not.toHaveBeenCalled();
    expect(f.audit.append).not.toHaveBeenCalled();
    expect(f.stored()).toEqual(supportTicketToSnapshot(ticket));
  });

  it('uses a scoped lean read with no hydration or domain-object sharing', async () => {
    const original = retainedClaims(),
      f = fixture(original),
      props = original.toProps();
    const first = await f.repo.findById(props.ticketId, organizationId);
    expect(f.model.findOne).toHaveBeenCalledWith({
      _id: props.ticketId,
      organizationId: expect.objectContaining({}),
    });
    expect(f.model.findOne.mock.calls[0][0].organizationId.toHexString()).toBe(organizationId);
    expect(f.query.lean).toHaveBeenCalled();
    first!.close(operatorId, at(1));
    expect((await f.repo.findById(props.ticketId, organizationId))!.toProps()).toEqual(props);
    expect(f.connection.startSession).not.toHaveBeenCalled();
  });

  it('returns null when the scoped query finds no Ticket', async () => {
    const f = fixture(null);
    await expect(f.repo.findById('missing', foreignId)).resolves.toBeNull();
    expect(f.model.findOne.mock.calls[0][0].organizationId.toHexString()).toBe(foreignId);
  });

  it('rejects a mismatched Organisation returned by a faulty read adapter without disclosure', async () => {
    const ticket = newTicket(),
      f = fixture(ticket);
    await expect(f.repo.findById(ticket.toProps().ticketId, foreignId)).resolves.toBeNull();
    expect(f.model.findOne.mock.calls[0][0].organizationId.toHexString()).toBe(foreignId);
    expect(f.audit.append).not.toHaveBeenCalled();
  });

  it.each(['', 'slug', 'AAAAAAAAAAAAAAAAAAAAAAAA'])(
    'rejects malformed/noncanonical scope %s before querying',
    async (id) => {
      const f = fixture();
      await expect(f.repo.findById('ticket', id)).rejects.toThrow('INVALID_SUPPORT_TICKET');
      expect(f.model.findOne).not.toHaveBeenCalled();
    },
  );

  it.each(['CLOSED', 'CANCELLED'] as const)(
    'CAS persists %s, full history and cleared references together with attributed audit',
    async (status) => {
      const ticket = retainedClaims(),
        f = fixture(ticket);
      if (status === 'CLOSED') ticket.close(operatorId, at(1));
      else ticket.cancel(operatorId, at(1));
      await expect(f.repo.save(ticket, 0)).resolves.toBe(true);
      const [filter, update, options] = f.writes.updateOne.mock.calls[0];
      expect(filter).toMatchObject({ _id: ticket.toProps().ticketId, revision: 0, status: 'OPEN' });
      expect(
        (filter as { organizationId: { toHexString(): string } }).organizationId.toHexString(),
      ).toBe(organizationId);
      expect(update.$set).toMatchObject({
        status,
        revision: 1,
        decisionReferences: null,
        episodes: ticket.toProps().episodes,
      });
      expect(update.$set).not.toHaveProperty('organizationId');
      expect(update.$set).not.toHaveProperty('requesterUserId');
      expect(update.$set).not.toHaveProperty('purposeId');
      expect(options).toEqual({ session: f.session, upsert: false });
      expect(f.audits()).toEqual([
        {
          actorUserId: operatorId,
          organizationId,
          action: `SUPPORT_TICKET_${status}`,
          resourceType: 'SUPPORT_TICKET',
          resourceId: ticket.toProps().ticketId,
          metadata: {
            episodeId: ticket.toProps().episodeId,
            expectedRevision: '0',
            revision: '1',
            status,
          },
        },
      ]);
    },
  );

  it('persists a fresh reopened episode and retains all prior episodes', async () => {
    const ticket = historyTicket('CANCELLED'),
      f = fixture(ticket),
      before = ticket.toProps();
    ticket.reopen(operatorId, at(6), 'new-episode');
    await expect(f.repo.save(ticket, 5)).resolves.toBe(true);
    expect(f.stored()!.episodes.slice(0, 3)).toEqual(before.episodes);
    expect(f.stored()).toMatchObject({
      episodeId: 'new-episode',
      revision: 6,
      decisionReferences: null,
    });
    expect(f.audits()[0]).toMatchObject({
      actorUserId: operatorId,
      organizationId,
      resourceType: 'SUPPORT_TICKET',
      resourceId: before.ticketId,
      action: 'SUPPORT_TICKET_REOPENED',
      metadata: {
        episodeId: 'new-episode',
        expectedRevision: '5',
        revision: '6',
        status: 'OPEN',
      },
    });
  });

  it.each(['missing', 'stale'] as const)(
    'returns false without writes or audit for a %s Ticket/revision',
    async (kind) => {
      const ticket = newTicket(),
        f = fixture(kind === 'missing' ? null : ticket);
      ticket.close(operatorId, at(1));
      if (kind === 'stale') {
        const current = SupportTicketEntity.fromPersistence(ticket.toProps());
        f.corrupt(supportTicketToSnapshot(current));
      }
      await expect(f.repo.save(ticket, 0)).resolves.toBe(false);
      expect(f.writes.updateOne).not.toHaveBeenCalled();
      expect(f.audit.append).not.toHaveBeenCalled();
    },
  );

  it('returns false on a confirmed lost database CAS without auditing or retrying', async () => {
    const ticket = newTicket(),
      f = fixture(ticket);
    ticket.close(operatorId, at(1));
    f.writes.updateOne.mockResolvedValueOnce({
      acknowledged: true,
      matchedCount: 0,
      modifiedCount: 0,
    });
    await expect(f.repo.save(ticket, 0)).resolves.toBe(false);
    expect(f.writes.updateOne).toHaveBeenCalledTimes(1);
    expect(f.audit.append).not.toHaveBeenCalled();
  });

  it.each(['requesterUserId', 'purposeId', 'createdAt'] as const)(
    'rejects changed immutable %s before any write',
    async (field) => {
      const ticket = newTicket(),
        f = fixture(ticket);
      ticket.close(operatorId, at(1));
      const props = ticket.toProps();
      const replacement = field === 'createdAt' ? at(-1) : foreignId;
      const episodes =
        field === 'requesterUserId'
          ? props.episodes.map((e) => ({ ...e, openedBy: foreignId }))
          : field === 'createdAt'
            ? props.episodes.map((e) => ({ ...e, openedAt: at(-1) }))
            : props.episodes;
      const changed = SupportTicketEntity.fromPersistence({
        ...props,
        [field]: replacement,
        episodes,
      });
      await expect(f.repo.save(changed, 0)).rejects.toMatchObject({
        response: { code: 'SUPPORT_TICKET_IMMUTABLE_FIELDS' },
      });
      expect(f.writes.updateOne).not.toHaveBeenCalled();
    },
  );

  it('rejects a self-consistent rewrite of previous history that passes revision arithmetic', async () => {
    const ticket = historyTicket(),
      f = fixture(ticket);
    ticket.close(operatorId, at(5));
    const props = ticket.toProps();
    const rewrite = SupportTicketEntity.fromPersistence({
      ...props,
      episodes: props.episodes.map((e, i) => (i === 1 ? { ...e, episodeId: 'rewritten-past' } : e)),
    });
    await expect(f.repo.save(rewrite, 4)).rejects.toMatchObject({
      response: { code: 'SUPPORT_TICKET_INVALID_TRANSITION' },
    });
    expect(f.writes.updateOne).not.toHaveBeenCalled();
  });

  it('does not permit a replacement snapshot to reuse an ID that belongs to persisted history', async () => {
    const ticket = historyTicket('CLOSED'),
      f = fixture(ticket),
      before = ticket.toProps();
    const episodes = before.episodes.map((e, i) =>
      i === 1 ? { ...e, episodeId: 'replacement' } : e,
    );
    const proposed = SupportTicketEntity.fromPersistence({ ...before, episodes });
    proposed.reopen(operatorId, at(6), before.episodes[1].episodeId);
    await expect(f.repo.save(proposed, 5)).rejects.toMatchObject({
      response: { code: 'SUPPORT_TICKET_EPISODE_REUSED' },
    });
    expect(f.writes.updateOne).not.toHaveBeenCalled();
  });

  it.each(['read', 'save'] as const)(
    'fails closed on corrupt stored history during %s',
    async (operation) => {
      const ticket = historyTicket(),
        f = fixture(ticket);
      f.corrupt({ ...supportTicketToSnapshot(ticket), revision: 0 });
      ticket.close(operatorId, at(5));
      await expect(
        operation === 'read'
          ? f.repo.findById(ticket.toProps().ticketId, organizationId)
          : f.repo.save(ticket, 4),
      ).rejects.toMatchObject({ response: { code: 'SUPPORT_TICKET_SNAPSHOT_INVALID' } });
      expect(f.writes.updateOne).not.toHaveBeenCalled();
    },
  );

  it.each(['create', 'save'] as const)(
    'audit failure aborts %s and its audit (staging fixture only)',
    async (operation) => {
      const ticket = newTicket(),
        f = fixture(operation === 'create' ? null : ticket),
        before = f.stored();
      f.audit.append.mockRejectedValueOnce(new Error('audit failure'));
      if (operation === 'save') ticket.close(operatorId, at(1));
      await expect(
        operation === 'create' ? f.repo.create(ticket) : f.repo.save(ticket, 0),
      ).rejects.toMatchObject({ response: { code: 'ATOMIC_MUTATION_ABORTED' } });
      expect(f.stored()).toEqual(before);
      expect(f.audits()).toEqual([]);
      expect(f.session.abortTransaction).toHaveBeenCalledTimes(1);
      expect(f.session.commitTransaction).not.toHaveBeenCalled();
      expect(f.session.endSession).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['create', 'save'] as const)(
    'does not report %s success when commit outcome is unknown or retry its callback',
    async (operation) => {
      const ticket = newTicket(),
        f = fixture(operation === 'create' ? null : ticket);
      f.control.commitError = {
        hasErrorLabel: (label: string) => label === 'UnknownTransactionCommitResult',
      };
      if (operation === 'save') ticket.close(operatorId, at(1));
      await expect(
        operation === 'create' ? f.repo.create(ticket) : f.repo.save(ticket, 0),
      ).rejects.toMatchObject({
        response: {
          code: 'SUPPORT_TICKET_OUTCOME_UNCONFIRMED',
          details: [{ mutationCommitted: 'unknown', retrySafe: false }],
        },
      });
      expect(f.session.startTransaction).toHaveBeenCalledTimes(1);
      expect(f.session.withTransaction).not.toHaveBeenCalled();
      expect(f.audits()).toHaveLength(1); // This case explicitly injects a post-commit error.
    },
  );

  it.each([
    { acknowledged: false, matchedCount: 0, modifiedCount: 0 },
    { acknowledged: true, matchedCount: 1, modifiedCount: 0 },
  ])('rejects unconfirmed/inconsistent update acknowledgement %j', async (result) => {
    const ticket = newTicket(),
      f = fixture(ticket);
    ticket.close(operatorId, at(1));
    f.writes.updateOne.mockResolvedValueOnce(result);
    await expect(f.repo.save(ticket, 0)).rejects.toMatchObject({
      response: { code: 'SUPPORT_TICKET_OUTCOME_UNCONFIRMED' },
    });
    expect(f.audit.append).not.toHaveBeenCalled();
  });

  it('rejects unacknowledged insertion before auditing', async () => {
    const ticket = newTicket(),
      f = fixture(null);
    f.writes.insertOne.mockResolvedValueOnce({
      acknowledged: false,
      insertedId: ticket.toProps().ticketId,
    });
    await expect(f.repo.create(ticket)).rejects.toMatchObject({
      response: { code: 'SUPPORT_TICKET_OUTCOME_UNCONFIRMED' },
    });
    expect(f.audit.append).not.toHaveBeenCalled();
  });

  it('fails closed on standalone Mongo before writing', async () => {
    const f = fixture(null);
    f.hello.mockResolvedValueOnce({});
    await expect(f.repo.create(newTicket())).rejects.toMatchObject({
      response: { code: 'MONGO_TRANSACTIONS_REQUIRED' },
    });
    expect(f.connection.startSession).not.toHaveBeenCalled();
    expect(f.writes.insertOne).not.toHaveBeenCalled();
  });

  it('captures the entity snapshot before asynchronous database work', async () => {
    const ticket = newTicket(),
      f = fixture(null);
    const pending = f.repo.create(ticket);
    ticket.close(operatorId, at(1));
    await pending;
    expect(f.stored()).toMatchObject({ status: 'OPEN', revision: 0 });
  });

  it('rejects noninitial creation and skipped transition revisions before touching MongoDB', async () => {
    const f = fixture(null),
      ticket = historyTicket();
    await expect(f.repo.create(ticket)).rejects.toMatchObject({
      response: { code: 'SUPPORT_TICKET_INVALID_CREATION' },
    });
    await expect(f.repo.save(ticket, 0)).rejects.toMatchObject({
      response: { code: 'SUPPORT_TICKET_INVALID_TRANSITION' },
    });
    expect(f.connection.startSession).not.toHaveBeenCalled();
  });

  describe('P1 mixed unknown-outcome regressions', () => {
    it.each([
      ['create', ['UnknownTransactionCommitResult']],
      ['save', ['UnknownTransactionCommitResult']],
      ['create', ['UnknownTransactionCommitResult', 'TransientTransactionError']],
      ['save', ['UnknownTransactionCommitResult', 'TransientTransactionError']],
    ] as const)(
      'preserves %s uncertainty after simulated commit, with code 11000 and labels %j',
      async (operation, labels) => {
        const ticket = newTicket(),
          f = fixture(operation === 'create' ? null : ticket);
        f.control.commitError = new mongo.MongoServerError({
          message: 'TEST post-commit uncertainty',
          code: 11000,
          errorLabels: [...labels],
        });
        if (operation === 'save') ticket.close(operatorId, at(1));
        await expect(
          operation === 'create' ? f.repo.create(ticket) : f.repo.save(ticket, 0),
        ).rejects.toMatchObject({
          response: {
            code: 'SUPPORT_TICKET_OUTCOME_UNCONFIRMED',
            details: [{ mutationCommitted: 'unknown', retrySafe: false }],
          },
        });
        expect(f.session.startTransaction).toHaveBeenCalledTimes(1);
        expect(f.session.withTransaction).not.toHaveBeenCalled();
        expect(
          operation === 'create' ? f.writes.insertOne : f.writes.updateOne,
        ).toHaveBeenCalledTimes(1);
        expect(f.audits()).toHaveLength(1); // Simulated persisted audit is possible, not a confirmed response.
        expect(f.audit.append).toHaveBeenCalledTimes(1);
      },
    );

    it.each(['create', 'save'] as const)(
      'does not classify uncertain %s write errors as duplicates/conflicts',
      async (operation) => {
        const ticket = newTicket(),
          f = fixture(operation === 'create' ? null : ticket);
        const error = new mongo.MongoServerError({
          message: 'TEST uncertain write',
          code: 11000,
          errorLabels: ['UnknownTransactionCommitResult', 'TransientTransactionError'],
        });
        if (operation === 'create') f.writes.insertOne.mockRejectedValueOnce(error);
        else {
          ticket.close(operatorId, at(1));
          f.writes.updateOne.mockRejectedValueOnce(error);
        }
        await expect(
          operation === 'create' ? f.repo.create(ticket) : f.repo.save(ticket, 0),
        ).rejects.toMatchObject({
          response: {
            code: 'SUPPORT_TICKET_OUTCOME_UNCONFIRMED',
            details: [{ mutationCommitted: 'unknown', retrySafe: false }],
          },
        });
        expect(f.session.startTransaction).toHaveBeenCalledTimes(1);
        expect(f.session.withTransaction).not.toHaveBeenCalled();
        expect(f.audit.append).not.toHaveBeenCalled();
      },
    );
  });

  describe.each(['create', 'save'] as const)('P1 strict Core transaction: %s', (operation) => {
    const unknown = 'UnknownTransactionCommitResult';
    const transient = 'TransientTransactionError';
    const commitErrors = [
      { code: 50, errorLabels: [unknown, transient] },
      { code: 11000, errorLabels: [unknown, transient] },
      { code: undefined, errorLabels: [unknown] },
    ];
    it.each(
      commitErrors.flatMap((outcome) =>
        [false, true].map((persisted) => ({ ...outcome, persisted })),
      ),
    )(
      'does not replay or infer commit outcome (code=$code, simulated persisted=$persisted)',
      async ({ code, errorLabels, persisted }) => {
        const ticket = newTicket(),
          f = fixture(operation === 'create' ? null : ticket),
          before = f.stored();
        const cause = new mongo.MongoServerError({
          message: 'TEST private commit diagnostic',
          ...(code === undefined ? {} : { code }),
          errorLabels,
        });
        f.control.commitError = cause;
        f.control.persistOnCommitError = persisted;
        if (operation === 'save') ticket.close(operatorId, at(1));
        const props = ticket.toProps();
        const pending = operation === 'create' ? f.repo.create(ticket) : f.repo.save(ticket, 0);
        await expect(pending).rejects.toMatchObject({
          response: {
            code: 'SUPPORT_TICKET_OUTCOME_UNCONFIRMED',
            details: [
              {
                resourceId: props.ticketId,
                organizationId,
                episodeId: props.episodeId,
                revision: props.revision,
                ...(operation === 'save' ? { expectedRevision: 0 } : {}),
                mutationCommitted: 'unknown',
                retrySafe: false,
              },
            ],
          },
        });
        const failure = await pending.catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(ServiceUnavailableException);
        expect((failure as ServiceUnavailableException).cause).toBe(cause);
        expect(
          JSON.stringify((failure as ServiceUnavailableException).getResponse()),
        ).not.toContain('private commit diagnostic');
        expect(f.session.withTransaction).not.toHaveBeenCalled();
        expect(f.session.startTransaction).toHaveBeenCalledTimes(1);
        expect(f.session.commitTransaction).toHaveBeenCalledTimes(1);
        expect(f.session.abortTransaction).not.toHaveBeenCalled();
        expect(f.session.endSession).toHaveBeenCalledTimes(1);
        expect(
          operation === 'create' ? f.writes.insertOne : f.writes.updateOne,
        ).toHaveBeenCalledTimes(1);
        expect(f.query.exec).toHaveBeenCalledTimes(operation === 'save' ? 1 : 0);
        expect(f.audit.append).toHaveBeenCalledTimes(1);
        // Only the explicit fixture control knows which simulated server state
        // exists. The response above is identical for both possibilities.
        expect(f.stored()).toEqual(persisted ? supportTicketToSnapshot(ticket) : before);
        expect(f.audits()).toHaveLength(persisted ? 1 : 0);
      },
    );

    it('aborts a transient-only pre-commit write failure without replaying work', async () => {
      const ticket = newTicket(),
        f = fixture(operation === 'create' ? null : ticket),
        before = f.stored();
      const cause = new mongo.MongoServerError({
        message: 'TEST pre-commit transient failure',
        code: 112,
        errorLabels: [transient],
      });
      if (operation === 'create') f.writes.insertOne.mockRejectedValueOnce(cause);
      else {
        ticket.close(operatorId, at(1));
        f.writes.updateOne.mockRejectedValueOnce(cause);
      }
      await expect(
        operation === 'create' ? f.repo.create(ticket) : f.repo.save(ticket, 0),
      ).rejects.toMatchObject({
        cause,
        response: {
          code: 'ATOMIC_MUTATION_ABORTED',
          details: [{ mutationCommitted: false, retrySafe: false }],
        },
      });
      expect(f.session.withTransaction).not.toHaveBeenCalled();
      expect(f.session.startTransaction).toHaveBeenCalledTimes(1);
      expect(f.session.abortTransaction).toHaveBeenCalledTimes(1);
      expect(f.session.commitTransaction).not.toHaveBeenCalled();
      expect(f.session.endSession).toHaveBeenCalledTimes(1);
      expect(
        operation === 'create' ? f.writes.insertOne : f.writes.updateOne,
      ).toHaveBeenCalledTimes(1);
      expect(f.audit.append).not.toHaveBeenCalled();
      expect(f.stored()).toEqual(before);
      expect(f.audits()).toEqual([]);
    });

    it.each([{ errorLabels: [] }, { errorLabels: [transient] }])(
      'does not claim rollback after an unconfirmed commit error ($errorLabels)',
      async ({ errorLabels }) => {
        const ticket = newTicket(),
          f = fixture(operation === 'create' ? null : ticket);
        const cause = new mongo.MongoServerError({ message: 'TEST commit failure', errorLabels });
        f.control.commitError = cause;
        if (operation === 'save') ticket.close(operatorId, at(1));
        await expect(
          operation === 'create' ? f.repo.create(ticket) : f.repo.save(ticket, 0),
        ).rejects.toMatchObject({
          cause,
          response: {
            code: 'SUPPORT_TICKET_OUTCOME_UNCONFIRMED',
            details: [{ mutationCommitted: 'unknown', retrySafe: false }],
          },
        });
        expect(f.session.startTransaction).toHaveBeenCalledTimes(1);
        expect(f.session.commitTransaction).toHaveBeenCalledTimes(1);
        expect(f.session.abortTransaction).not.toHaveBeenCalled();
        expect(f.session.withTransaction).not.toHaveBeenCalled();
      },
    );
  });

  describe('strict transaction lifecycle failures', () => {
    afterEach(() => jest.restoreAllMocks());

    it('waits for a confirmed commit before reporting creation success', async () => {
      const f = fixture(null);
      let enter!: () => void, release!: () => void;
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const commit = f.session.commitTransaction.getMockImplementation()!;
      f.session.commitTransaction.mockImplementationOnce(async () => {
        enter();
        await gate;
        return commit();
      });
      let settled = false;
      const pending = f.repo.create(newTicket()).then(() => {
        settled = true;
      });
      await entered;
      expect(settled).toBe(false);
      expect(f.session.endSession).not.toHaveBeenCalled();
      expect(f.audits()).toEqual([]);
      release();
      await pending;
      expect(settled).toBe(true);
      expect(f.audits()).toHaveLength(1);
      expect(f.session.endSession).toHaveBeenCalledTimes(1);
    });

    it('ends the session without executing business work when transaction start fails', async () => {
      const f = fixture(null),
        cause = new Error('TEST start failure');
      f.session.startTransaction.mockImplementationOnce(() => {
        throw cause;
      });
      await expect(f.repo.create(newTicket())).rejects.toMatchObject({
        cause,
        response: { code: 'ATOMIC_MUTATION_ABORTED' },
      });
      expect(f.writes.insertOne).not.toHaveBeenCalled();
      expect(f.audit.append).not.toHaveBeenCalled();
      expect(f.session.commitTransaction).not.toHaveBeenCalled();
      expect(f.session.abortTransaction).not.toHaveBeenCalled();
      expect(f.session.endSession).toHaveBeenCalledTimes(1);
    });

    it('retains the original pre-commit cause when abort and session cleanup fail', async () => {
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const f = fixture(null),
        cause = new Error('TEST audit failure');
      f.audit.append.mockRejectedValueOnce(cause);
      f.session.abortTransaction.mockRejectedValueOnce(new Error('TEST abort failure'));
      f.session.endSession.mockRejectedValueOnce(new Error('TEST cleanup failure'));
      const failure: unknown = await f.repo.create(newTicket()).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(ServiceUnavailableException);
      expect((failure as ServiceUnavailableException).cause).toBe(cause);
      expect(f.session.commitTransaction).not.toHaveBeenCalled();
      expect(f.session.abortTransaction).toHaveBeenCalledTimes(1);
      expect(f.session.endSession).toHaveBeenCalledTimes(1);
      expect(f.stored()).toBeNull();
      expect(f.audits()).toEqual([]);
    });

    it('does not mask an uncertain commit with a session cleanup failure', async () => {
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const f = fixture(null);
      const cause = new mongo.MongoServerError({
        message: 'TEST unknown commit',
        code: 50,
        errorLabels: ['UnknownTransactionCommitResult', 'TransientTransactionError'],
      });
      f.control.commitError = cause;
      f.session.endSession.mockRejectedValueOnce(new Error('TEST cleanup failure'));
      const failure: unknown = await f.repo.create(newTicket()).catch((error: unknown) => error);
      expect(failure).toMatchObject({ response: { code: 'SUPPORT_TICKET_OUTCOME_UNCONFIRMED' } });
      expect((failure as ServiceUnavailableException).cause).toBe(cause);
      expect(f.session.commitTransaction).toHaveBeenCalledTimes(1);
      expect(f.session.abortTransaction).not.toHaveBeenCalled();
      expect(f.session.startTransaction).toHaveBeenCalledTimes(1);
      expect(f.session.endSession).toHaveBeenCalledTimes(1);
    });

    it('retains a confirmed success when session cleanup fails', async () => {
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const f = fixture(null),
        ticket = newTicket();
      f.session.endSession.mockRejectedValueOnce(new Error('TEST cleanup failure'));
      await expect(f.repo.create(ticket)).resolves.toBeUndefined();
      expect(f.stored()).toEqual(supportTicketToSnapshot(ticket));
      expect(f.audits()).toHaveLength(1);
      expect(f.session.commitTransaction).toHaveBeenCalledTimes(1);
      expect(f.session.abortTransaction).not.toHaveBeenCalled();
      expect(f.session.endSession).toHaveBeenCalledTimes(1);
    });
  });
});
