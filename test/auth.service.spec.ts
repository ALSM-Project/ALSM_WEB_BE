import { ConflictException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { OAuth2Client } from 'google-auth-library';
import { AuthService } from '../src/modules/auth/application/auth.service';
import { OrganizationType } from '../src/modules/organizations/domain/organization.types';

describe('AuthService', () => {
  const jwt = { signAsync: jest.fn().mockResolvedValue('signed-token'), verifyAsync: jest.fn() };
  const config = {
    get: jest.fn().mockReturnValue('fixture-google-client'),
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
  const sessions = {
    create: jest.fn(),
    updateTokenHash: jest.fn(),
    findActive: jest.fn(),
    revoke: jest.fn(),
    rotateRefresh: jest.fn(),
    revokeBrowserSession: jest.fn(),
    findForLogout: jest.fn(),
  };
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

  it('creates generation-bound credentials after email verification', async () => {
    emailVerificationService.verify.mockResolvedValue({
      id: '507f1f77bcf86cd799439011',
      email: 'verified@example.invalid',
      isEmailVerified: true,
      mfa: { enabled: false },
      isActive: true,
      isLocked: false,
      passwordHash: 'set',
      mustChangePassword: false,
    });
    sessions.create.mockImplementation(async (input) => ({
      ...input,
      id: '507f1f77bcf86cd799439012',
    }));
    users.findById.mockImplementation(
      async () => emailVerificationService.verify.mock.results.at(-1)?.value,
    );
    await service.verifyEmail('verified@example.invalid', 'fixture-code');
    expect(jwt.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({ sid: '507f1f77bcf86cd799439012', sv: expect.any(String) }),
      expect.objectContaining({ secret: 'a' }),
    );
    expect(jwt.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        sid: '507f1f77bcf86cd799439012',
        fid: expect.any(String),
        tid: expect.any(String),
      }),
      expect.objectContaining({ secret: 'b' }),
    );
  });

  it('preserves Google session creation and forced set-password metadata without external calls', async () => {
    const verify = jest.spyOn(OAuth2Client.prototype, 'verifyIdToken').mockResolvedValue({
      getPayload: () => ({
        aud: 'fixture-google-client',
        email_verified: true,
        email: 'google@example.invalid',
      }),
    } as never);
    try {
      users.findByEmail.mockResolvedValue({
        id: '507f1f77bcf86cd799439011',
        email: 'google@example.invalid',
        isActive: true,
        isLocked: false,
        isEmailVerified: true,
        mustChangePassword: true,
      });
      sessions.create.mockImplementation(async (input) => ({
        ...input,
        id: '507f1f77bcf86cd799439012',
      }));
      users.findById.mockImplementation(async () => users.findByEmail.mock.results.at(-1)?.value);
      const result = await service.loginWithGoogle('fixture-google-token');
      expect(result).toMatchObject({ mustChangePassword: true, hasPassword: false });
      expect(sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          familyId: expect.any(String),
          accessVersion: expect.any(String),
        }),
      );
      expect(verify).toHaveBeenCalledTimes(1);
    } finally {
      verify.mockRestore();
    }
  });

  it('registers a user, self-service organization, owner membership, audit event, and sends verification email', async () => {
    users.findByEmail.mockResolvedValue(null);
    users.create.mockResolvedValue({
      id: '507f1f77bcf86cd799439011',
      email: 'a@example.com',
      fullName: 'Ada',
      isPlatformAdmin: false,
      isActive: true,
      isLocked: false,
      isEmailVerified: false,
    });
    organizations.create.mockResolvedValue({ id: 'o1' });
    sessions.create.mockImplementation(async (input) => ({
      ...input,
      id: '507f1f77bcf86cd799439012',
    }));

    const result = await service.register('A@Example.com', 'a-strong-password', 'Ada');

    expect(organizations.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: OrganizationType.SELF_SERVICE,
        members: [{ userId: '507f1f77bcf86cd799439011', role: 'OWNER' }],
      }),
    );
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'USER_REGISTERED' }),
    );
    expect(emailVerificationService.sendVerificationEmail).toHaveBeenCalled();
    expect(result.requiresEmailVerification).toBe(true);
  });

  it('does not authenticate an invalid password', async () => {
    users.findByEmail.mockResolvedValue(null);
    await expect(service.login('a@example.com', 'wrong')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('maps a duplicate-key (E11000) create failure to EMAIL_ALREADY_REGISTERED conflict', async () => {
    users.findByEmail.mockResolvedValue(null);
    users.create.mockRejectedValue({ code: 11000 });

    const promise = service.register('a@example.com', 'a-strong-password', 'Ada');
    await expect(promise).rejects.toBeInstanceOf(ConflictException);
    await expect(promise).rejects.toMatchObject({
      response: { code: 'EMAIL_ALREADY_REGISTERED' },
    });

    expect(users.create).toHaveBeenCalledTimes(1);
    expect(organizations.create).not.toHaveBeenCalled();
  });

  it('persists normalized session metadata instead of the raw User-Agent when creating a login session', async () => {
    users.findByEmail.mockResolvedValue({
      id: '507f1f77bcf86cd799439011',
      email: 'a@example.com',
      fullName: 'Ada',
      passwordHash: await bcrypt.hash('a-strong-password', 4),
      isPlatformAdmin: false,
      isActive: true,
      isLocked: false,
      isEmailVerified: true,
    });
    sessions.create.mockImplementation(async (input) => ({
      ...input,
      id: '507f1f77bcf86cd799439012',
    }));

    users.findById.mockImplementation(async () => users.findByEmail.mock.results.at(-1)?.value);
    await service.login(
      'a@example.com',
      'a-strong-password',
      'Mozilla/5.0 (Windows NT 10.0) Chrome/140.0 Safari/537.36',
    );

    expect(sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceType: 'Desktop',
        browser: 'Chrome',
        lastActiveAt: expect.any(Date),
      }),
    );
    expect(sessions.create.mock.calls[0][0]).not.toHaveProperty('userAgent');
    expect(jwt.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: '507f1f77bcf86cd799439011',
        email: 'a@example.com',
        isPlatformAdmin: false,
        sid: '507f1f77bcf86cd799439012',
      }),
      expect.objectContaining({ secret: 'a' }),
    );
  });

  it('atomically rotates the generation in the same browser session', async () => {
    const refreshToken = 'valid-refresh-token';
    jwt.verifyAsync.mockResolvedValue({ sub: '507f1f77bcf86cd799439011', tid: 'old-token-id' });
    sessions.findActive.mockResolvedValue({
      id: '507f1f77bcf86cd799439012',
      userId: '507f1f77bcf86cd799439011',
      tokenId: 'old-token-id',
      expiresAt: new Date(Date.now() + 60000),
      refreshTokenHash: await bcrypt.hash(refreshToken, 4),
    });
    users.findById.mockResolvedValue({
      id: '507f1f77bcf86cd799439011',
      email: 'a@example.com',
      isPlatformAdmin: false,
      isEmailVerified: true,
      isActive: true,
      isLocked: false,
    });
    sessions.rotateRefresh.mockResolvedValue(true);

    await service.refresh(refreshToken);

    expect(sessions.revoke).not.toHaveBeenCalled();
    expect(sessions.create).not.toHaveBeenCalled();
    expect(sessions.rotateRefresh).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: '507f1f77bcf86cd799439012',
        expectedTokenId: 'old-token-id',
      }),
    );
    expect(jwt.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({ sid: '507f1f77bcf86cd799439012', sv: expect.any(String) }),
      expect.objectContaining({ secret: 'a' }),
    );
  });
});
