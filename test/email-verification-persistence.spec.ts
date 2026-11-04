import { Types } from 'mongoose';
import { MongoEmailVerificationRepository } from '../src/modules/auth/infrastructure/mongo-email-verification.repository';
import { MongoUserRepository } from '../src/modules/users/infrastructure/mongo-user.repository';
import { admissionFixture, userId } from './authentication-admission.fixture';

describe('verification persistence atomic predicates', () => {
  it('binds consumption to identity, exact proof, unconsumed state and current expiry with majority acknowledgement', async () => {
    const f = await admissionFixture();
    const exec = jest
      .fn()
      .mockResolvedValue({ acknowledged: true, matchedCount: 1, modifiedCount: 1 });
    const model = { updateOne: jest.fn(() => ({ exec })) };
    const repository = new MongoEmailVerificationRepository(model as never);
    const { id, tokenHash, code } = f.record;
    await expect(repository.consumeActive({ id, userId, tokenHash, code })).resolves.toBe(true);
    expect(model.updateOne).toHaveBeenCalledWith(
      {
        _id: new Types.ObjectId(id),
        userId: new Types.ObjectId(userId),
        tokenHash,
        code,
        consumedAt: { $exists: false },
        expiresAt: { $gt: expect.any(Date) },
      },
      { $set: { consumedAt: expect.any(Date) } },
      { writeConcern: { w: 'majority', wtimeoutMS: 10000 } },
    );
  });
  it.each([
    { acknowledged: true, matchedCount: 0, modifiedCount: 0 },
    { acknowledged: true, matchedCount: 1, modifiedCount: 0 },
  ])('does not treat a nonwinning write as proof consumption', async (result) => {
    const f = await admissionFixture();
    const repository = new MongoEmailVerificationRepository({
      updateOne: () => ({ exec: async () => result }),
    } as never);
    await expect(repository.consumeActive(f.record)).resolves.toBe(false);
  });
  it('rejects unacknowledged consumption without retry', async () => {
    const f = await admissionFixture();
    const exec = jest.fn().mockResolvedValue({ acknowledged: false });
    const repository = new MongoEmailVerificationRepository({
      updateOne: () => ({ exec }),
    } as never);
    await expect(repository.consumeActive(f.record)).rejects.toThrow(
      'VERIFICATION_CONSUMPTION_UNCONFIRMED',
    );
    expect(exec).toHaveBeenCalledTimes(1);
  });
  it('rejects malformed IDs without accessing storage', async () => {
    const f = await admissionFixture();
    const updateOne = jest.fn();
    const repository = new MongoEmailVerificationRepository({ updateOne } as never);
    await expect(repository.consumeActive({ ...f.record, id: 'invalid' })).resolves.toBe(false);
    expect(updateOne).not.toHaveBeenCalled();
  });
  it('conditionally marks only the eligible unverified identity, without touching credentials or privilege', async () => {
    const exec = jest.fn().mockResolvedValue(null);
    const query = { select: jest.fn().mockReturnValue({ exec }) };
    const model = { findOneAndUpdate: jest.fn().mockReturnValue(query) };
    const users = new MongoUserRepository(model as never);
    await expect(
      users.markEmailVerifiedIfUnverified(userId, 'isolated@example.invalid'),
    ).resolves.toBeNull();
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: userId,
        email: 'isolated@example.invalid',
        isEmailVerified: false,
        isActive: true,
        isLocked: false,
        'mfa.enabled': false,
      },
      { $set: { isEmailVerified: true } },
      { new: true, writeConcern: { w: 'majority', wtimeoutMS: 10000 } },
    );
  });
});
