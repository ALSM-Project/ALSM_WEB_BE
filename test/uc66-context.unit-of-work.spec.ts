import { ForbiddenException, Logger } from '@nestjs/common';
import { Connection, Model, mongo } from 'mongoose';
import { MongoSupportContextUnitOfWork } from '../src/modules/support/infrastructure/mongo-support-context.unit-of-work';
import {
  SUPPORT_ACTIVE_ORIGIN_INDEX,
  SupportContextSnapshot,
} from '../src/modules/support/infrastructure/support-context.schema';
import { SupportContextError } from '../src/modules/support/domain/support-context.entity';

function fixture() {
  const control = { active: false, replica: true };
  const session = {
    explicit: true,
    hasEnded: false,
    transaction: {},
    inTransaction: () => control.active,
    startTransaction: jest.fn(() => {
      control.active = true;
      session.transaction = {};
    }),
    commitTransaction: jest.fn(async () => {
      control.active = false;
    }),
    abortTransaction: jest.fn(async () => {
      control.active = false;
    }),
    endSession: jest.fn(async () => undefined),
    withTransaction: jest.fn(async () => {
      throw new Error('Convenience transaction API must not be used');
    }),
  };
  const connection = {
    db: {
      admin: () => ({ command: async () => (control.replica ? { setName: 'TEST replica' } : {}) }),
    },
    startSession: jest.fn(async () => session),
  };
  const indexes = [
    {
      name: SUPPORT_ACTIVE_ORIGIN_INDEX,
      key: { actorUserId: 1, originalSessionId: 1 },
      unique: true,
      partialFilterExpression: { state: 'ACTIVE' },
    },
  ];
  const model = {
    db: connection,
    collection: { listIndexes: () => ({ toArray: async () => indexes }) },
  };
  const audit = { bind: jest.fn(() => ({ append: jest.fn() })) };
  const unit = new MongoSupportContextUnitOfWork(
    connection as unknown as Connection,
    model as unknown as Model<SupportContextSnapshot>,
    audit,
  );
  return { unit, session, connection, audit, indexes, control };
}

const driverError = (
  body: object,
  labels: string[] = ['UnknownTransactionCommitResult', 'TransientTransactionError'],
) =>
  new mongo.MongoServerError({ message: 'TEST transaction outcome', ...body, errorLabels: labels });

describe('UC-66 explicit Core Transaction API outcomes (unit simulation)', () => {
  it('executes business work once and binds context/audit to the exact explicit session', async () => {
    const f = fixture(),
      work = jest.fn(async () => 'confirmed');
    await expect(f.unit.run('original-context', work)).resolves.toBe('confirmed');
    expect(f.session.startTransaction).toHaveBeenCalledWith({
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' },
      readPreference: 'primary',
      maxCommitTimeMS: 10000,
    });
    expect(f.audit.bind).toHaveBeenCalledWith({ session: f.session, connection: f.connection });
    expect(work).toHaveBeenCalledTimes(1);
    expect(f.session.commitTransaction).toHaveBeenCalledTimes(1);
    expect(f.session.withTransaction).not.toHaveBeenCalled();
    expect(f.session.abortTransaction).not.toHaveBeenCalled();
    expect(f.session.endSession).toHaveBeenCalledTimes(1);
  });

  it.each([
    { name: 'code 50 mixed labels', error: () => driverError({ code: 50 }) },
    {
      name: 'nested write concern 50',
      error: () => driverError({ writeConcernError: { code: 50 } }),
    },
    {
      name: 'code 64 with nested write concern 50',
      error: () => driverError({ code: 64, writeConcernError: { code: 50 } }),
    },
    { name: 'code 11000 mixed-label control', error: () => driverError({ code: 11000 }) },
    {
      name: 'unknown-only label',
      error: () => driverError({}, ['UnknownTransactionCommitResult']),
    },
    { name: 'code 50 without labels', error: () => driverError({ code: 50 }, []) },
    { name: 'unlabelled transport failure', error: () => new Error('TEST lost acknowledgement') },
  ])('returns UNCONFIRMED without replay after commit: $name', async ({ error }) => {
    const f = fixture(),
      work = jest.fn(async () => 'may be committed');
    f.session.commitTransaction.mockImplementationOnce(async () => {
      f.control.active = false;
      throw error();
    });
    await expect(f.unit.run('original-context-id', work)).rejects.toMatchObject({
      status: 503,
      response: {
        code: 'SUPPORT_CONTEXT_OUTCOME_UNCONFIRMED',
        details: [
          { contextId: 'original-context-id', mutationCommitted: 'unknown', retrySafe: false },
        ],
      },
    });
    expect(work).toHaveBeenCalledTimes(1);
    expect(f.session.commitTransaction).toHaveBeenCalledTimes(1);
    expect(f.session.withTransaction).not.toHaveBeenCalled();
    expect(f.session.abortTransaction).not.toHaveBeenCalled();
    expect(f.session.endSession).toHaveBeenCalledTimes(1);
  });

  it('retains the definite inactive-context conflict after abort', async () => {
    const f = fixture();
    await expect(
      f.unit.run('context', async () => {
        throw new SupportContextError('SUPPORT_CONTEXT_INACTIVE');
      }),
    ).rejects.toMatchObject({ status: 409, response: { code: 'SUPPORT_CONTEXT_INACTIVE' } });
    expect(f.session.abortTransaction).toHaveBeenCalledTimes(1);
    expect(f.session.commitTransaction).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'ordinary duplicate', error: () => driverError({ code: 11000 }, []) },
    {
      name: 'genuine pre-commit transient',
      error: () => driverError({ code: 112 }, ['TransientTransactionError']),
    },
  ])('aborts $name as a known conflict without business replay', async ({ error }) => {
    const f = fixture(),
      work = jest.fn(async () => {
        throw error();
      });
    await expect(f.unit.run('context', work)).rejects.toMatchObject({
      status: 409,
      response: {
        code: 'SUPPORT_CONTEXT_CONFLICT',
        details: [{ contextId: 'context', mutationCommitted: false, retrySafe: false }],
      },
    });
    expect(work).toHaveBeenCalledTimes(1);
    expect(f.session.abortTransaction).toHaveBeenCalledTimes(1);
    expect(f.session.commitTransaction).not.toHaveBeenCalled();
  });

  it('does not replay an unknown-labelled business error even before the outer commit call', async () => {
    const f = fixture(),
      work = jest.fn(async () => {
        throw driverError({ code: 50 });
      });
    await expect(f.unit.run('context', work)).rejects.toMatchObject({
      status: 503,
      response: { code: 'SUPPORT_CONTEXT_OUTCOME_UNCONFIRMED' },
    });
    expect(work).toHaveBeenCalledTimes(1);
    expect(f.session.commitTransaction).not.toHaveBeenCalled();
  });

  it('preserves an authorization denial and aborts without committing', async () => {
    const f = fixture(),
      denial = new ForbiddenException({ code: 'SUPPORT_ACCESS_DENIED' });
    await expect(
      f.unit.run('context', async () => {
        throw denial;
      }),
    ).rejects.toBe(denial);
    expect(f.session.abortTransaction).toHaveBeenCalledTimes(1);
    expect(f.session.commitTransaction).not.toHaveBeenCalled();
  });

  it('reports a generic pre-commit storage failure as uncommitted, without driver details', async () => {
    const f = fixture();
    await expect(
      f.unit.run('context', async () => {
        throw new Error('private driver data');
      }),
    ).rejects.toMatchObject({
      status: 503,
      response: {
        code: 'SUPPORT_CONTEXT_PERSISTENCE_UNAVAILABLE',
        details: [{ contextId: 'context', mutationCommitted: false, retrySafe: false }],
      },
    });
    expect(f.session.abortTransaction).toHaveBeenCalledTimes(1);
  });

  it('fails closed without the required unique partial index', async () => {
    const f = fixture(),
      work = jest.fn();
    f.indexes.length = 0;
    await expect(f.unit.run('context', work)).rejects.toMatchObject({
      status: 503,
      response: { code: 'SUPPORT_CONTEXT_INDEX_UNAVAILABLE' },
    });
    expect(work).not.toHaveBeenCalled();
    expect(f.connection.startSession).not.toHaveBeenCalled();
  });

  it('fails closed on a standalone topology before business work', async () => {
    const f = fixture(),
      work = jest.fn();
    f.control.replica = false;
    await expect(f.unit.run('context', work)).rejects.toMatchObject({
      status: 503,
      response: { code: 'MONGO_TRANSACTIONS_REQUIRED' },
    });
    expect(work).not.toHaveBeenCalled();
    expect(f.connection.startSession).not.toHaveBeenCalled();
  });

  it('does not mask an initial session acquisition failure with cleanup', async () => {
    const f = fixture(),
      work = jest.fn();
    f.connection.startSession.mockRejectedValueOnce(new Error('TEST session unavailable'));
    await expect(f.unit.run('context', work)).rejects.toMatchObject({
      status: 503,
      response: { code: 'SUPPORT_CONTEXT_PERSISTENCE_UNAVAILABLE' },
    });
    expect(work).not.toHaveBeenCalled();
    expect(f.session.endSession).not.toHaveBeenCalled();
  });

  it('preserves a pre-commit conflict when both abort and session cleanup fail', async () => {
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      const f = fixture();
      f.session.abortTransaction.mockRejectedValueOnce(new Error('TEST abort cleanup'));
      f.session.endSession.mockRejectedValueOnce(new Error('TEST end cleanup'));
      await expect(
        f.unit.run('context', async () => {
          throw driverError({ code: 11000 }, []);
        }),
      ).rejects.toMatchObject({ status: 409, response: { code: 'SUPPORT_CONTEXT_CONFLICT' } });
      expect(log).toHaveBeenCalledTimes(2);
    } finally {
      log.mockRestore();
    }
  });

  it('preserves UNCONFIRMED when session cleanup fails', async () => {
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      const f = fixture();
      f.session.commitTransaction.mockRejectedValueOnce(driverError({ code: 50 }));
      f.session.endSession.mockRejectedValueOnce(new Error('TEST end cleanup'));
      await expect(f.unit.run('context', async () => 'committed')).rejects.toMatchObject({
        status: 503,
        response: { code: 'SUPPORT_CONTEXT_OUTCOME_UNCONFIRMED' },
      });
    } finally {
      log.mockRestore();
    }
  });

  it('preserves confirmed success when session cleanup fails', async () => {
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      const f = fixture();
      f.session.endSession.mockRejectedValueOnce(new Error('TEST end cleanup'));
      await expect(f.unit.run('context', async () => 'confirmed')).resolves.toBe('confirmed');
    } finally {
      log.mockRestore();
    }
  });

  it('releases same-context scheduling after a failed invocation without replaying it', async () => {
    const f = fixture(),
      first = jest.fn(async () => {
        throw new Error('TEST failure');
      }),
      next = jest.fn(async () => 'next request');
    await expect(f.unit.run('context', first)).rejects.toMatchObject({ status: 503 });
    await expect(f.unit.run('context', next)).resolves.toBe('next request');
    expect(first).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
