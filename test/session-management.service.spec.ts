import { NotFoundException } from '@nestjs/common';
import { ListActiveSessionsService } from '../src/modules/auth/application/list-active-sessions.service';
import { RevokeSessionService } from '../src/modules/auth/application/revoke-session.service';

describe('session management application services', () => {
  const sessions = {
    findActiveByUserId: jest.fn(),
    revokeUserSession: jest.fn(),
  };
  const audit = { append: jest.fn() };

  const listActiveSessions = new ListActiveSessionsService(sessions as never);
  const revokeSession = new RevokeSessionService(sessions as never, audit as never);

  beforeEach(() => jest.clearAllMocks());

  it('lists only repository-selected active sessions using safe fields and legacy fallbacks', async () => {
    const expiresAt = new Date('2030-01-02T03:04:05.000Z');
    const createdAt = new Date('2030-01-01T03:04:05.000Z');
    sessions.findActiveByUserId.mockResolvedValue([
      {
        id: 'own-session',
        userId: 'authenticated-user',
        tokenId: 'token-id',
        refreshTokenHash: 'secret-hash',
        expiresAt,
        createdAt,
      },
    ]);

    const result = await listActiveSessions.execute('authenticated-user');

    expect(sessions.findActiveByUserId).toHaveBeenCalledWith('authenticated-user');
    expect(result).toEqual([
      {
        id: 'own-session',
        deviceType: 'Unknown',
        browser: 'Unknown',
        lastActiveAt: createdAt,
        createdAt,
        expiresAt,
      },
    ]);
    expect(result[0]).not.toHaveProperty('refreshTokenHash');
    expect(result[0]).not.toHaveProperty('tokenId');
  });

  it('revokes a session only through the authenticated user ownership scope and audits no secrets', async () => {
    sessions.revokeUserSession.mockResolvedValue(true);

    await revokeSession.execute({ userId: 'authenticated-user', sessionId: 'owned-session' });

    expect(sessions.revokeUserSession).toHaveBeenCalledWith('authenticated-user', 'owned-session');
    expect(audit.append).toHaveBeenCalledWith({
      actorUserId: 'authenticated-user',
      action: 'USER_SESSION_REVOKED',
      resourceType: 'USER_SESSION',
      resourceId: 'owned-session',
    });
  });

  it('returns the same generic failure for foreign, expired, revoked, or missing sessions', async () => {
    sessions.revokeUserSession.mockResolvedValue(false);

    const getFailure = async (sessionId: string): Promise<NotFoundException> => {
      try {
        await revokeSession.execute({ userId: 'authenticated-user', sessionId });
        throw new Error('Expected session revocation to fail');
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundException);
        return error as NotFoundException;
      }
    };

    const foreignSessionFailure = await getFailure('another-users-session');
    const revokedSessionFailure = await getFailure('already-revoked-session');

    expect(foreignSessionFailure.getResponse()).toEqual(revokedSessionFailure.getResponse());
    expect(audit.append).not.toHaveBeenCalled();
  });
});
