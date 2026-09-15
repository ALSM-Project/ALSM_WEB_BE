import { GUARDS_METADATA, HEADERS_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuthController } from '../src/modules/auth/presentation/auth.controller';
import { SessionIdParamDto } from '../src/modules/auth/presentation/auth.dto';
import { JwtAuthGuard } from '../src/shared/security/jwt-auth.guard';

describe('AuthController session endpoints', () => {
  const auth = { login: jest.fn() };
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

  it('uses only CurrentUser identity when listing and revoking sessions', async () => {
    const date = new Date('2030-01-01T00:00:00.000Z');
    listActiveSessions.execute.mockResolvedValue([
      {
        id: 'owned-session',
        deviceType: 'Desktop',
        browser: 'Firefox',
        lastActiveAt: date,
        createdAt: date,
        expiresAt: date,
      },
    ]);

    await expect(controller.getSessions(user)).resolves.toEqual([
      {
        id: 'owned-session',
        deviceType: 'Desktop',
        browser: 'Firefox',
        lastActiveAt: date.toISOString(),
        createdAt: date.toISOString(),
        expiresAt: date.toISOString(),
      },
    ]);
    await controller.revokeSession(user, { sessionId: '507f1f77bcf86cd799439012' });

    expect(listActiveSessions.execute).toHaveBeenCalledWith('authenticated-user');
    expect(revokeSession.execute).toHaveBeenCalledWith({
      userId: 'authenticated-user',
      sessionId: '507f1f77bcf86cd799439012',
    });
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

  it('passes the HTTP User-Agent to authentication without accepting session metadata from the body', async () => {
    auth.login.mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh' });

    await controller.login(
      {
        email: 'customer@example.com',
        password: 'a-strong-password',
        deviceType: 'Mobile',
      } as never,
      'Mozilla/5.0 (Windows NT 10.0) Chrome/140.0 Safari/537.36',
    );

    expect(auth.login).toHaveBeenCalledWith(
      'customer@example.com',
      'a-strong-password',
      'Mozilla/5.0 (Windows NT 10.0) Chrome/140.0 Safari/537.36',
    );
  });
});
