import { JwtAuthGuard } from '../src/shared/security/jwt-auth.guard';
import { RequestWithContext } from '../src/shared/logging/request-id.middleware';
import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';

describe('JwtAuthGuard', () => {
  const jwt = { verifyAsync: jest.fn() };
  const config = { getOrThrow: jest.fn().mockReturnValue('access-secret') };
  const sessions = { execute: jest.fn() };
  const guard = new JwtAuthGuard(jwt as never, config as never, sessions as never);

  beforeEach(() => {
    jest.clearAllMocks();
    sessions.execute.mockReset().mockResolvedValue(undefined);
  });

  const contextFor = (request: RequestWithContext) =>
    ({
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => contextFor,
    }) as never;

  describe.each(['test', 'development', 'production'])('in %s', (environment) => {
    const originalEnvironment = process.env.NODE_ENV;
    beforeEach(() => {
      process.env.NODE_ENV = environment;
    });
    afterEach(() => {
      if (originalEnvironment === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalEnvironment;
    });

    it('rejects a missing JWT with 401', async () => {
      const request = { headers: {} } as RequestWithContext;
      await expect(guard.canActivate(contextFor(request))).rejects.toMatchObject({
        status: 401,
        response: { code: 'UNAUTHORIZED' },
      });
      expect(jwt.verifyAsync).not.toHaveBeenCalled();
      expect(sessions.execute).not.toHaveBeenCalled();
      expect(request.user).toBeUndefined();
    });

    it('rejects an invalid JWT with 401', async () => {
      jwt.verifyAsync.mockRejectedValue(new Error('invalid signature'));
      const request = { headers: { authorization: 'Bearer invalid' } } as RequestWithContext;
      await expect(guard.canActivate(contextFor(request))).rejects.toMatchObject({
        status: 401,
        response: { code: 'UNAUTHORIZED' },
      });
      expect(request.user).toBeUndefined();
      expect(sessions.execute).not.toHaveBeenCalled();
    });

    it('accepts a verified JWT and preserves the session context', async () => {
      jwt.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        email: 'user@example.com',
        isPlatformAdmin: false,
        sid: 'session-1',
      });
      const request = { headers: { authorization: 'Bearer valid' } } as RequestWithContext;
      await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
      expect(jwt.verifyAsync).toHaveBeenCalledWith('valid', { secret: 'access-secret' });
      expect(sessions.execute).toHaveBeenCalledWith('user-1', 'session-1', undefined);
      expect(request.user).toEqual({
        userId: 'user-1',
        email: 'user@example.com',
        isPlatformAdmin: false,
        sessionId: 'session-1',
        sessionVersion: undefined,
      });
    });
  });

  it('propagates sid from an access token to the authenticated request context', async () => {
    jwt.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      email: 'customer@example.com',
      isPlatformAdmin: false,
      sid: 'session-1',
    });
    const request = { headers: { authorization: 'Bearer access-token' } } as RequestWithContext;

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);

    expect(request.user).toEqual({
      userId: 'user-1',
      email: 'customer@example.com',
      isPlatformAdmin: false,
      sessionId: 'session-1',
      sessionVersion: undefined,
    });
  });

  it('rejects ordinary sessionless access tokens, including legacy signed tokens', async () => {
    jwt.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      email: 'customer@example.com',
      isPlatformAdmin: false,
    });
    const request = {
      headers: { authorization: 'Bearer old-access-token' },
    } as RequestWithContext;

    sessions.execute.mockRejectedValue(
      new UnauthorizedException({ code: 'CURRENT_SESSION_REQUIRED' }),
    );
    await expect(guard.canActivate(contextFor(request))).rejects.toMatchObject({
      status: 401,
      response: { code: 'CURRENT_SESSION_REQUIRED' },
    });
    expect(sessions.execute).toHaveBeenCalledWith('user-1', undefined, undefined);
    expect(request.user).toBeUndefined();
  });

  it.each([
    new UnauthorizedException({ code: 'CURRENT_SESSION_REQUIRED' }),
    new ServiceUnavailableException({
      code: 'SESSION_ASSURANCE_UNAVAILABLE',
      message: 'Session state could not be verified',
    }),
  ])(
    'preserves assurance errors without publishing identity or masking them as JWT errors',
    async (error) => {
      jwt.verifyAsync.mockResolvedValue({ sub: 'user-1', sid: 'session-1' });
      sessions.execute.mockRejectedValue(error);
      const request = { headers: { authorization: 'Bearer signed' } } as RequestWithContext;
      await expect(guard.canActivate(contextFor(request))).rejects.toBe(error);
      expect(request.user).toBeUndefined();
    },
  );
});
