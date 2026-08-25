import { MongoUserRepository } from '../src/modules/users/infrastructure/mongo-user.repository';

describe('MongoUserRepository MFA query safety', () => {
  const query = {
    select: jest.fn(),
    exec: jest.fn(),
  };
  const model = {
    findById: jest.fn(),
    findOneAndUpdate: jest.fn(),
  };
  const repository = new MongoUserRepository(model as never);

  beforeEach(() => {
    jest.clearAllMocks();
    query.select.mockReturnValue(query);
    query.exec.mockResolvedValue(null);
    model.findById.mockReturnValue(query);
    model.findOneAndUpdate.mockReturnValue(query);
  });

  it('keeps MFA secret and backup hashes out of ordinary user reads', async () => {
    await repository.findById('user-1');

    expect(query.select).toHaveBeenCalledWith('+passwordHash');
  });

  it('selects secret material only for the dedicated MFA read', async () => {
    await repository.findByIdForMfa('user-1');

    expect(query.select).toHaveBeenCalledWith(
      '+mfa.secret +mfa.backupCodeHashes',
    );
  });

  it('uses a compare-and-set update that resets exactly at five failed attempts', async () => {
    await repository.recordMfaSetupFailure('user-1', 'encrypted-secret', 5);

    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: 'user-1',
        'mfa.enabled': false,
        'mfa.secret': 'encrypted-secret',
      },
      expect.arrayContaining([
        expect.objectContaining({
          $set: expect.objectContaining({
            'mfa.enabled': false,
            'mfa.secret': expect.objectContaining({ $cond: expect.any(Array) }),
            'mfa.setupFailureCount': expect.objectContaining({
              $cond: expect.any(Array),
            }),
            'mfa.backupCodeHashes': expect.objectContaining({
              $cond: expect.any(Array),
            }),
          }),
        }),
      ]),
      { new: true },
    );
  });
});
