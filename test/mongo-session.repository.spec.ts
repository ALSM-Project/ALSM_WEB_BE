import * as bcrypt from 'bcrypt';
import { MongoSessionRepository } from '../src/modules/auth/infrastructure/mongo-session.repository';

describe('MongoSessionRepository session management queries', () => {
  const userId = '507f1f77bcf86cd799439011';
  const sessionId = '507f1f77bcf86cd799439012';

  it('returns false for malformed IDs without querying MongoDB', async () => {
    const model = { updateOne: jest.fn() };
    const repository = new MongoSessionRepository(model as never);

    await expect(repository.revokeUserSession(userId, 'malformed')).resolves.toBe(false);

    expect(model.updateOne).not.toHaveBeenCalled();
  });

  it('uses one atomic ownership-scoped active-session predicate for revocation', async () => {
    const exec = jest
      .fn()
      .mockResolvedValue({ acknowledged: true, matchedCount: 1, modifiedCount: 1 });
    const updateOne = jest.fn().mockReturnValue({ exec });
    const repository = new MongoSessionRepository({ updateOne } as never);

    await expect(repository.revokeUserSession(userId, sessionId)).resolves.toBe(true);

    expect(updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: sessionId,
        revokedAt: { $exists: false },
        expiresAt: { $gt: expect.any(Date) },
      }),
      { $set: { revokedAt: expect.any(Date) } },
      { writeConcern: { w: 'majority', wtimeoutMS: 10000 } },
    );
    expect(updateOne.mock.calls[0][0].userId.toString()).toBe(userId);
  });

  it('queries active sessions by user while excluding revoked and expired records', async () => {
    const exec = jest.fn().mockResolvedValue([]);
    const sort = jest.fn().mockReturnValue({ exec });
    const read = jest.fn().mockReturnValue({ sort });
    const find = jest.fn().mockReturnValue({ read });
    const repository = new MongoSessionRepository({ find } as never);

    await expect(repository.findActiveByUserId(userId)).resolves.toEqual([]);

    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        revokedAt: { $exists: false },
        expiresAt: { $gt: expect.any(Date) },
      }),
    );
    expect(find.mock.calls[0][0].userId.toString()).toBe(userId);
    expect(sort).toHaveBeenCalledWith({ createdAt: -1 });
  });
});

const userId = '507f1f77bcf86cd799439011';
const sessionId = '507f1f77bcf86cd799439012';

describe('repository security write outcomes', () => {
  it.each([false, true])(
    'does not replay revoke-others after unknown commit (transaction active=%s)',
    async (active) => {
      const transaction = {
        startTransaction: jest.fn(),
        commitTransaction: jest
          .fn()
          .mockRejectedValue({ errorLabels: ['UnknownTransactionCommitResult'] }),
        abortTransaction: jest.fn(),
        inTransaction: () => active,
        endSession: jest.fn(),
      };
      const fence = jest.fn().mockResolvedValue({ id: sessionId });
      const others = jest
        .fn()
        .mockResolvedValue({ acknowledged: true, matchedCount: 2, modifiedCount: 2 });
      const model = {
        db: { startSession: jest.fn().mockResolvedValue(transaction) },
        findOneAndUpdate: jest.fn().mockReturnValue({ exec: fence }),
        updateMany: jest.fn().mockReturnValue({ exec: others }),
      };
      const repo = new MongoSessionRepository(model as never);
      await expect(repo.revokeAllOther(userId, sessionId)).rejects.toThrow(
        'SESSION_PERSISTENCE_UNAVAILABLE',
      );
      expect(fence).toHaveBeenCalledTimes(1);
      expect(others).toHaveBeenCalledTimes(1);
      expect(transaction.commitTransaction).toHaveBeenCalledTimes(1);
      expect(transaction.endSession).toHaveBeenCalledTimes(1);
    },
  );
  it('requires an acknowledged exact CAS result and scopes the write to the consumed proof', async () => {
    const hash = await bcrypt.hash('fixture', 4);
    const exec = jest
      .fn()
      .mockResolvedValue({ acknowledged: false, matchedCount: 1, modifiedCount: 1 });
    const updateOne = jest.fn().mockReturnValue({ exec });
    const repo = new MongoSessionRepository({ updateOne } as never);
    const input = {
      sessionId,
      userId,
      familyId: 'family',
      expectedTokenId: 'old',
      expectedTokenHash: hash,
      successorTokenId: 'new',
      successorTokenHash: hash,
      expiresAt: new Date(Date.now() + 60000),
      lastActiveAt: new Date(),
    };
    await expect(repo.rotateRefresh(input)).rejects.toThrow('SESSION_PERSISTENCE_UNAVAILABLE');
    expect(updateOne).toHaveBeenCalledTimes(1);
    expect(updateOne.mock.calls[0][0]).toMatchObject({
      tokenId: 'old',
      refreshTokenHash: hash,
      revokedAt: { $exists: false },
      expiresAt: { $gt: expect.any(Date) },
    });
    exec.mockResolvedValueOnce({ acknowledged: true, matchedCount: 0, modifiedCount: 0 });
    await expect(repo.rotateRefresh(input)).resolves.toBe(false);
  });
});
