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
    const exec = jest.fn().mockResolvedValue({ modifiedCount: 1 });
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
    );
    expect(updateOne.mock.calls[0][0].userId.toString()).toBe(userId);
  });

  it('queries active sessions by user while excluding revoked and expired records', async () => {
    const exec = jest.fn().mockResolvedValue([]);
    const sort = jest.fn().mockReturnValue({ exec });
    const find = jest.fn().mockReturnValue({ sort });
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
