import { JwtAuthGuard } from '../src/shared/security/jwt-auth.guard';
import { RequestWithContext } from '../src/shared/logging/request-id.middleware';

describe('JwtAuthGuard', () => {
  const jwt = { verifyAsync: jest.fn() };
  const config = { getOrThrow: jest.fn().mockReturnValue('access-secret') };
  const guard = new JwtAuthGuard(jwt as never, config as never);

  beforeEach(() => jest.clearAllMocks());

  const contextFor = (request: RequestWithContext) =>
    ({
      switchToHttp: () => ({ getRequest: () => request }),
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
      expect(request.user).toEqual({
        userId: 'user-1',
        email: 'user@example.com',
        isPlatformAdmin: false,
        sessionId: 'session-1',
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
    });
  });

  it('accepts valid access tokens issued before sid was added', async () => {
    jwt.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      email: 'customer@example.com',
      isPlatformAdmin: false,
    });
    const request = {
      headers: { authorization: 'Bearer old-access-token' },
    } as RequestWithContext;

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);

    expect(request.user).toEqual({
      userId: 'user-1',
      email: 'customer@example.com',
      isPlatformAdmin: false,
      sessionId: undefined,
    });
  });
});
