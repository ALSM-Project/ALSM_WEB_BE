import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../src/modules/auth/application/auth.service';
import { OrganizationType } from '../src/modules/organizations/domain/organization.types';

describe('AuthService', () => {
  const jwt = { signAsync: jest.fn().mockResolvedValue('signed-token'), verifyAsync: jest.fn() };
  const config = {
    getOrThrow: jest.fn(
      (key: string) =>
        ({
          JWT_ACCESS_EXPIRES_IN: '15m',
          JWT_REFRESH_EXPIRES_IN: '7d',
          JWT_ACCESS_SECRET: 'a',
          JWT_REFRESH_SECRET: 'b',
        })[key],
    ),
  };
  const users = { findByEmail: jest.fn(), create: jest.fn(), findById: jest.fn() };
  const organizations = { create: jest.fn() };
  const sessions = { create: jest.fn(), updateTokenHash: jest.fn(), findActive: jest.fn(), revoke: jest.fn() };
  const audit = { append: jest.fn() };
  const effectivePermissions = {
    getUserRoles: jest.fn().mockResolvedValue([]),
    getEffectivePermissions: jest.fn().mockResolvedValue([]),
  };
  const emailVerificationService = {
    sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
    verify: jest.fn(),
    resendVerification: jest.fn(),
  };

  const service = new AuthService(
    jwt as never,
    config as never,
    users as never,
    organizations as never,
    sessions as never,
    audit as never,
    effectivePermissions as never,
    emailVerificationService as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('registers a user, self-service organization, owner membership, audit event, and sends verification email', async () => {
    users.findByEmail.mockResolvedValue(null);
    users.create.mockResolvedValue({ id: 'u1', email: 'a@example.com', fullName: 'Ada', isPlatformAdmin: false, isActive: true, isEmailVerified: false });
    organizations.create.mockResolvedValue({ id: 'o1' });
    sessions.create.mockResolvedValue({ id: 's1' });

    const result = await service.register('A@Example.com', 'a-strong-password', 'Ada');

    expect(organizations.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: OrganizationType.SELF_SERVICE, members: [{ userId: 'u1', role: 'OWNER' }] }),
    );
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({ action: 'USER_REGISTERED' }));
    expect(emailVerificationService.sendVerificationEmail).toHaveBeenCalled();
    expect(result.requiresEmailVerification).toBe(true);
  });

  it('does not authenticate an invalid password', async () => {
    users.findByEmail.mockResolvedValue(null);
    await expect(service.login('a@example.com', 'wrong')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
