import { GUARDS_METADATA, HEADERS_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuthController } from '../src/modules/auth/presentation/auth.controller';
import { SessionIdParamDto } from '../src/modules/auth/presentation/auth.dto';
import { JwtAuthGuard } from '../src/shared/security/jwt-auth.guard';

describe('AuthController session endpoints', () => {
  const auth = {
    verifyEmail: jest.fn(),
    login: jest.fn(),
    loginWithGoogle: jest.fn(),
    refresh: jest.fn(),
  };
  const listActiveSessions = { execute: jest.fn() };
  const revokeSession = { execute: jest.fn() };
  const controller = new AuthController(
    auth as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    listActiveSessions as never,
    revokeSession as never,
  );
  const user = {
    userId: 'authenticated-user',
    email: 'customer@example.com',
    isPlatformAdmin: false,
    sessionId: 'current-session',
  };

  beforeEach(() => jest.clearAllMocks());

  it('protects session listing and remote logout with JwtAuthGuard', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AuthController.prototype.getSessions)).toContain(
      JwtAuthGuard,
    );
    expect(Reflect.getMetadata(GUARDS_METADATA, AuthController.prototype.revokeSession)).toContain(
      JwtAuthGuard,
    );
  });

  it('uses the authenticated user and session identity when listing and revoking sessions', async () => {
    const date = new Date('2030-01-01T00:00:00.000Z');
    listActiveSessions.execute.mockResolvedValue([
      {
        id: 'current-session',
        deviceType: 'Desktop',
        browser: 'Firefox',
        lastActiveAt: date,
        createdAt: date,
        expiresAt: date,
      },
    ]);

    await expect(controller.getSessions(user)).resolves.toEqual([
      {
        id: 'current-session',
        deviceType: 'Desktop',
        browser: 'Firefox',
        lastActiveAt: date.toISOString(),
        createdAt: date.toISOString(),
        expiresAt: date.toISOString(),
        isCurrent: true,
      },
    ]);
    await controller.revokeSession(user, { sessionId: '507f1f77bcf86cd799439012' });

    expect(listActiveSessions.execute).toHaveBeenCalledWith('authenticated-user');
    expect(revokeSession.execute).toHaveBeenCalledWith({
      userId: 'authenticated-user',
      sessionId: '507f1f77bcf86cd799439012',
    });
  });

  it('marks only the session identified by the access token as current', async () => {
    const date = new Date('2030-01-01T00:00:00.000Z');
    listActiveSessions.execute.mockResolvedValue([
      {
        id: 'current-session',
        deviceType: 'Desktop',
        browser: 'Firefox',
        lastActiveAt: date,
        createdAt: date,
        expiresAt: date,
      },
      {
        id: 'other-session',
        deviceType: 'Mobile',
        browser: 'Safari',
        lastActiveAt: date,
        createdAt: date,
        expiresAt: date,
      },
    ]);

    const result = await controller.getSessions(user);

    expect(result.map((session) => ({ id: session.id, isCurrent: session.isCurrent }))).toEqual([
      { id: 'current-session', isCurrent: true },
      { id: 'other-session', isCurrent: false },
    ]);
    expect(result[0]).not.toHaveProperty('tokenId');
    expect(result[0]).not.toHaveProperty('refreshTokenHash');
    expect(result[0]).not.toHaveProperty('accessToken');
    expect(result[0]).not.toHaveProperty('refreshToken');
  });

  it('marks no session as current for access tokens issued before sid was introduced', async () => {
    const date = new Date('2030-01-01T00:00:00.000Z');
    listActiveSessions.execute.mockResolvedValue([
      {
        id: 'older-session',
        deviceType: 'Desktop',
        browser: 'Firefox',
        lastActiveAt: date,
        createdAt: date,
        expiresAt: date,
      },
    ]);

    await expect(controller.getSessions({ ...user, sessionId: undefined })).resolves.toEqual([
      expect.objectContaining({ id: 'older-session', isCurrent: false }),
    ]);
  });

  it('does not cache session-list responses and rejects malformed session IDs', async () => {
    expect(
      Reflect.getMetadata(HEADERS_METADATA, AuthController.prototype.getSessions),
    ).toContainEqual({
      name: 'Cache-Control',
      value: 'no-store',
    });

    const malformed = plainToInstance(SessionIdParamDto, { sessionId: 'not-an-object-id' });
    await expect(validate(malformed)).resolves.not.toHaveLength(0);
  });

  it.each([
    {
      name: 'verify-email',
      invoke: (userAgent: string) =>
        controller.verifyEmail({ email: 'customer@example.com', code: '123456' }, userAgent),
      authMethod: auth.verifyEmail,
      expectedArguments: ['customer@example.com', '123456'],
    },
    {
      name: 'login',
      invoke: (userAgent: string) =>
        controller.login(
          {
            email: 'customer@example.com',
            password: 'a-strong-password',
            deviceType: 'Mobile',
          } as never,
          userAgent,
        ),
      authMethod: auth.login,
      expectedArguments: ['customer@example.com', 'a-strong-password'],
    },
    {
      name: 'Google login',
      invoke: (userAgent: string) => controller.google({ idToken: 'google-id-token' }, userAgent),
      authMethod: auth.loginWithGoogle,
      expectedArguments: ['google-id-token'],
    },
    {
      name: 'refresh',
      invoke: (userAgent: string) =>
        controller.refresh({ refreshToken: 'refresh-token' }, userAgent),
      authMethod: auth.refresh,
      expectedArguments: ['refresh-token'],
    },
  ])(
    'passes the HTTP User-Agent through the $name session-creating path',
    async ({ invoke, authMethod, expectedArguments }) => {
      const userAgent = 'Mozilla/5.0 (Windows NT 10.0) Chrome/140.0 Safari/537.36';
      authMethod.mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh' });

      await invoke(userAgent);

      expect(authMethod).toHaveBeenCalledWith(...expectedArguments, userAgent);
    },
  );
});
