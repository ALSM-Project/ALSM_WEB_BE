import { ClientSession, Connection, mongo } from 'mongoose';
import { MongoTransactionRunner } from '../src/shared/database/mongo-transaction-runner';

function fixture(replica = true) {
  const session = {
    withTransaction: jest.fn(async (work: (value: unknown) => Promise<unknown>): Promise<unknown> =>
      work('exact-session'),
    ),
    endSession: jest.fn().mockResolvedValue(undefined),
  };
  const connection = {
    db: {
      admin: () => ({ command: jest.fn().mockResolvedValue(replica ? { setName: 'test' } : {}) }),
    },
    startSession: jest.fn().mockResolvedValue(session),
  };
  return {
    session,
    connection,
    runner: new MongoTransactionRunner(connection as unknown as Connection),
  };
}
describe('MongoDB atomic mutation outcomes', () => {
  it('fails closed on standalone Mongo before any mutation or session', async () => {
    const f = fixture(false),
      work = jest.fn();
    await expect(f.runner.run(work, 'id')).rejects.toMatchObject({
      response: { code: 'MONGO_TRANSACTIONS_REQUIRED' },
    });
    expect(work).not.toHaveBeenCalled();
    expect(f.connection.startSession).not.toHaveBeenCalled();
  });
  it('uses snapshot, majority and primary on the exact session and always disposes it', async () => {
    const f = fixture();
    await expect(
      f.runner.run(async (session) => {
        expect(session).toBe(f.session);
        return 'committed';
      }, 'id'),
    ).resolves.toBe('committed');
    expect(f.session.withTransaction).toHaveBeenCalledWith(expect.any(Function), {
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' },
      readPreference: 'primary',
      maxCommitTimeMS: 10000,
    });
    expect(f.session.endSession).toHaveBeenCalledTimes(1);
  });
  it('distinguishes an aborted transaction from an uncertain commit without leaking driver errors', async () => {
    const f = fixture();
    await expect(
      f.runner.run(async () => {
        throw new Error('private driver details');
      }, 'id'),
    ).rejects.toMatchObject({
      response: {
        code: 'ATOMIC_MUTATION_ABORTED',
        details: [{ mutationCommitted: false, retrySafe: false }],
      },
    });
    f.session.withTransaction.mockRejectedValueOnce({
      hasErrorLabel: (label: string) => label === 'UnknownTransactionCommitResult',
    });
    await expect(f.runner.run(async () => 'unconfirmed', 'id')).rejects.toMatchObject({
      response: {
        code: 'TEAM_MUTATION_OUTCOME_UNCONFIRMED',
        details: [{ resourceId: 'id', mutationCommitted: 'unknown', retrySafe: false }],
      },
    });
  });
  it('restarts only once after a duplicate-key race, using the original operation identity', async () => {
    const f = fixture();
    f.session.withTransaction.mockRejectedValueOnce({ code: 11000 });
    await expect(f.runner.run(async () => 'same operation', 'stable-id')).resolves.toBe(
      'same operation',
    );
    expect(f.session.withTransaction).toHaveBeenCalledTimes(2);
  });
});

describe('P1 uncertainty precedence and existing driver retry behavior', () => {
  const unknown = 'UnknownTransactionCommitResult';
  const transient = 'TransientTransactionError';
  const driverError = (code: number | undefined, errorLabels: string[]) =>
    new mongo.MongoServerError({
      message: 'TEST driver outcome',
      ...(code === undefined ? {} : { code }),
      errorLabels,
    });

  it.each([
    [undefined, [unknown]],
    [11000, [unknown]],
    [11000, [unknown, transient]],
  ] as const)(
    'does not replay a callback after simulated commit (code=%s labels=%j)',
    async (code, labels) => {
      const f = fixture();
      const work = jest.fn().mockResolvedValue('business and audit may be committed');
      f.session.withTransaction.mockImplementationOnce(async (callback) => {
        await callback('exact-session');
        throw driverError(code, [...labels]);
      });
      await expect(f.runner.run(work, 'stable-id')).rejects.toMatchObject({
        response: {
          code: 'TEAM_MUTATION_OUTCOME_UNCONFIRMED',
          details: [{ resourceId: 'stable-id', mutationCommitted: 'unknown', retrySafe: false }],
        },
      });
      expect(work).toHaveBeenCalledTimes(1);
      expect(f.session.withTransaction).toHaveBeenCalledTimes(1);
      expect(f.session.endSession).toHaveBeenCalledTimes(1);
    },
  );

  it('retains the one bounded retry for ordinary duplicate+transient errors escaping the driver', async () => {
    const f = fixture(),
      work = jest.fn().mockResolvedValue('same-id');
    f.session.withTransaction.mockRejectedValueOnce(driverError(11000, [transient]));
    await expect(f.runner.run(work, 'stable-id')).resolves.toBe('same-id');
    expect(f.session.withTransaction).toHaveBeenCalledTimes(2);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('does not widen the existing duplicate retry bound', async () => {
    const f = fixture(),
      work = jest.fn();
    f.session.withTransaction.mockRejectedValue(driverError(11000, []));
    await expect(f.runner.run(work, 'stable-id')).rejects.toMatchObject({
      response: { code: 'ATOMIC_MUTATION_ABORTED' },
    });
    expect(f.session.withTransaction).toHaveBeenCalledTimes(2);
    expect(work).not.toHaveBeenCalled();
  });

  // Execute the INSTALLED driver's withTransaction algorithm with fake transport
  // methods. This verifies delegation/retry semantics, not database behavior.
  function installedDriver() {
    const f = fixture();
    const session = {
      transaction: { state: 'NO_TRANSACTION' },
      timeoutMS: undefined,
      timeoutContext: null,
      startTransaction: jest.fn(() => {
        session.transaction.state = 'TRANSACTION_IN_PROGRESS';
      }),
      abortTransaction: jest.fn(async () => {
        session.transaction.state = 'TRANSACTION_ABORTED';
      }),
      commitTransaction: jest.fn(async () => {
        session.transaction.state = 'TRANSACTION_COMMITTED';
      }),
      endSession: jest.fn().mockResolvedValue(undefined),
      withTransaction: jest.fn<Promise<unknown>, [() => Promise<unknown>, object]>(),
    };
    session.withTransaction.mockImplementation((work, options) =>
      mongo.ClientSession.prototype.withTransaction.call(
        session as unknown as ClientSession,
        work,
        options,
      ),
    );
    f.connection.startSession.mockResolvedValue(session as unknown as typeof f.session);
    return { runner: f.runner, session };
  }

  it('leaves genuine transient whole-transaction retry with the installed driver', async () => {
    const f = installedDriver(),
      work = jest
        .fn()
        .mockRejectedValueOnce(driverError(11000, [transient]))
        .mockResolvedValue('committed');
    await expect(f.runner.run(work, 'id')).resolves.toBe('committed');
    expect(work).toHaveBeenCalledTimes(2);
    expect(f.session.withTransaction).toHaveBeenCalledTimes(1);
    expect(f.session.abortTransaction).toHaveBeenCalledTimes(1);
    expect(f.session.commitTransaction).toHaveBeenCalledTimes(1);
  });

  it('leaves unknown-result commit-only retry with the installed driver', async () => {
    const f = installedDriver(),
      work = jest.fn().mockResolvedValue('committed');
    f.session.commitTransaction.mockRejectedValueOnce(driverError(11000, [unknown, transient]));
    await expect(f.runner.run(work, 'id')).resolves.toBe('committed');
    expect(work).toHaveBeenCalledTimes(1);
    expect(f.session.withTransaction).toHaveBeenCalledTimes(1);
    expect(f.session.commitTransaction).toHaveBeenCalledTimes(2);
  });

  it.each([{ labels: [unknown] }, { labels: [unknown, transient] }])(
    'normalizes uncertain callback errors before driver business retry ($labels)',
    async ({ labels }) => {
      const f = installedDriver();
      const work = jest
        .fn()
        .mockRejectedValueOnce(driverError(11000, labels))
        .mockResolvedValue('unsafe replay');
      await expect(f.runner.run(work, 'id')).rejects.toMatchObject({
        response: {
          code: 'TEAM_MUTATION_OUTCOME_UNCONFIRMED',
          details: [{ mutationCommitted: 'unknown', retrySafe: false }],
        },
      });
      expect(work).toHaveBeenCalledTimes(1);
      expect(f.session.withTransaction).toHaveBeenCalledTimes(1);
      expect(f.session.commitTransaction).not.toHaveBeenCalled();
    },
  );
});
