import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { ResetPasswordService } from '../src/modules/auth/application/reset-password.service';

describe('ResetPasswordService invitation activation', () => {
  const users = {
    updatePassword: jest.fn().mockResolvedValue(undefined),
    markEmailVerified: jest.fn().mockResolvedValue(undefined),
  };
  const passwordResets = {
    findActive: jest.fn(),
    consume: jest.fn().mockResolvedValue(undefined),
  };
  const service = new ResetPasswordService(users as never, passwordResets as never);

  beforeEach(() => jest.clearAllMocks());

  it('sets a password, verifies the invited email, and consumes the one-use token', async () => {
    passwordResets.findActive.mockResolvedValue({ id: 'reset-1', userId: 'user-1' });
    const rawToken = 'a'.repeat(64);

    await service.execute(rawToken, 'NewSecurePassword123!');

    expect(passwordResets.findActive).toHaveBeenCalledWith(createHash('sha256').update(rawToken).digest('hex'));
    expect(users.updatePassword).toHaveBeenCalledWith('user-1', expect.any(String));
    expect(users.markEmailVerified).toHaveBeenCalledWith('user-1');
    expect(passwordResets.consume).toHaveBeenCalledWith('reset-1');
  });

  it('does not change account state when the reset token is invalid', async () => {
    passwordResets.findActive.mockResolvedValue(null);

    await expect(service.execute('expired-token', 'NewSecurePassword123!')).rejects.toBeInstanceOf(BadRequestException);
    expect(users.updatePassword).not.toHaveBeenCalled();
    expect(users.markEmailVerified).not.toHaveBeenCalled();
    expect(passwordResets.consume).not.toHaveBeenCalled();
  });
});
