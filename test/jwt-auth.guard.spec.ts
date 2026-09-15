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
