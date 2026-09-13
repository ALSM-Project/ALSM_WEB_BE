import { AuthService } from '../src/modules/auth/application/auth.service';

describe('AuthService user projection', () => {
  it('does not expose MFA secret or backup-code hashes from /auth/me', async () => {
    const users = {
      findById: jest.fn().mockResolvedValue({
        id: 'user-1',
        email: 'customer@example.com',
        passwordHash: 'password-hash',
        fullName: 'Customer',
        isPlatformAdmin: false,
        isActive: true,
        mfa: {
          enabled: true,
          secret: 'encrypted-mfa-secret',
          setupFailureCount: 0,
          backupCodeHashes: ['backup-code-hash'],
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    };
    const effectivePermissions = {
      getUserRoles: jest.fn().mockResolvedValue(['CUSTOMER']),
      getEffectivePermissions: jest.fn().mockResolvedValue([]),
    };
    const service = new AuthService(
      {} as never,
      {} as never,
      users as never,
      {} as never,
      {} as never,
      {} as never,
      effectivePermissions as never,
      {} as never,
    );

    const response = await service.me('user-1');

    expect(response).not.toHaveProperty('passwordHash');
    expect(response).not.toHaveProperty('mfa');
    expect(JSON.stringify(response)).not.toContain('encrypted-mfa-secret');
    expect(JSON.stringify(response)).not.toContain('backup-code-hash');
    expect(response.hasPassword).toBe(true);
    expect(response.twoFactorEnabled).toBe(true);
    expect(response.providers).toEqual(['PASSWORD', 'GOOGLE']);
  });

  it('correctly projects hasPassword=false for Google-only user', async () => {
    const users = {
      findById: jest.fn().mockResolvedValue({
        id: 'user-google',
        email: 'googleuser@example.com',
        fullName: 'Google User',
        isPlatformAdmin: false,
        isActive: true,
        mfa: { enabled: false },
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    };
    const effectivePermissions = {
      getUserRoles: jest.fn().mockResolvedValue([]),
      getEffectivePermissions: jest.fn().mockResolvedValue([]),
    };
    const service = new AuthService(
      {} as never,
      {} as never,
      users as never,
      {} as never,
      {} as never,
      {} as never,
      effectivePermissions as never,
      {} as never,
    );

    const response = await service.me('user-google');

    expect(response.hasPassword).toBe(false);
    expect(response.twoFactorEnabled).toBe(false);
    expect(response.providers).toEqual(['GOOGLE']);
  });
});

