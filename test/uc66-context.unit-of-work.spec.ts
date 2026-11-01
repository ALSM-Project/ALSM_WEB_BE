import { Connection, Model, mongo } from 'mongoose';
import { MongoSupportContextUnitOfWork } from '../src/modules/support/infrastructure/mongo-support-context.unit-of-work';
import {
  SUPPORT_ACTIVE_ORIGIN_INDEX,
  SupportContextSnapshot,
} from '../src/modules/support/infrastructure/support-context.schema';
import { SupportContextError } from '../src/modules/support/domain/support-context.entity';

function fixture() {
  const session = {
    explicit: true,
    hasEnded: false,
    transaction: {},
    inTransaction: () => true,
    withTransaction: jest.fn(async (work) => work()),
    endSession: jest.fn(),
  };
  const connection = {
    db: { admin: () => ({ command: async () => ({ setName: 'TEST replica' }) }) },
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
  return { unit, session, connection, audit, indexes };
}

describe('UC-66 transaction outcome handling (driver simulation)', () => {
  it('retains the definite inactive-context conflict across transaction error normalization', async () => {
    const f = fixture();
    await expect(
      f.unit.run('context', async () => {
        throw new SupportContextError('SUPPORT_CONTEXT_INACTIVE');
      }),
    ).rejects.toMatchObject({ status: 409, response: { code: 'SUPPORT_CONTEXT_INACTIVE' } });
  });
  it.each([undefined, 11000])(
    'does not replay business work after an unknown commit with code %s',
    async (code) => {
      const f = fixture(),
        work = jest.fn(async () => 'may be committed');
      f.session.withTransaction.mockImplementationOnce(async (callback) => {
        await callback();
        throw new mongo.MongoServerError({
          message: 'TEST unknown',
          code,
          errorLabels: ['UnknownTransactionCommitResult', 'TransientTransactionError'],
        });
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
      expect(f.session.withTransaction).toHaveBeenCalledTimes(1);
    },
  );

  it('fails closed without the required unique partial index', async () => {
    const f = fixture(),
      work = jest.fn();
    f.indexes.length = 0;
    await expect(f.unit.run('context', work)).rejects.toMatchObject({
      status: 503,
      response: { code: 'SUPPORT_CONTEXT_INDEX_UNAVAILABLE' },
    });
    expect(work).not.toHaveBeenCalled();
  });

  it('binds context and audit participants to the exact same session and connection', async () => {
    const f = fixture();
    await expect(f.unit.run('context', async () => 'ok')).resolves.toBe('ok');
    expect(f.audit.bind).toHaveBeenCalledWith({ session: f.session, connection: f.connection });
  });

  it('maps an ordinary duplicate to a conflict without a business retry', async () => {
    const f = fixture(),
      work = jest.fn(async () => {
        throw new mongo.MongoServerError({ message: 'TEST duplicate', code: 11000 });
      });
    await expect(f.unit.run('context', work)).rejects.toMatchObject({ status: 409 });
    expect(work).toHaveBeenCalledTimes(1);
  });
});
