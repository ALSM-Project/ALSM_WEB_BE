import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { SetPasswordService } from '../src/modules/auth/application/set-password.service';

describe('SetPasswordService', () => {
  const users = {
    findById: jest.fn(),
    updatePassword: jest.fn(),
  };
  const service = new SetPasswordService(users as never);

  beforeEach(() => jest.clearAllMocks());

  it('allows a user without a password (Google user) to set an initial password', async () => {
    users.findById.mockResolvedValue({
      id: 'u-google',
      email: 'google@example.com',
      isActive: true,
      passwordHash: undefined,
    });

    await service.execute('u-google', 'NewPass123!');

    expect(users.updatePassword).toHaveBeenCalledWith('u-google', expect.any(String));
  });

  it('throws ConflictException if user already has a password set', async () => {
    users.findById.mockResolvedValue({
      id: 'u-existing',
      email: 'existing@example.com',
      isActive: true,
      passwordHash: 'existing-hash',
    });

    await expect(service.execute('u-existing', 'NewPass123!')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('throws UnauthorizedException if user is not active or missing', async () => {
    users.findById.mockResolvedValue(null);

    await expect(service.execute('unknown', 'NewPass123!')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
