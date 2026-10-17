import { Connection } from 'mongoose';
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
