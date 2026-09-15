import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from '../src/modules/auth/application/auth.service';
import { RevokeSessionService } from '../src/modules/auth/application/revoke-session.service';

describe('remote session revocation lifecycle', () => {
  it('removes the selected active refresh session and rejects its subsequent refresh token', async () => {
    const refreshToken = 'selected-refresh-token';
    const session = {
      id: 'selected-session',
      tokenId: 'selected-token-id',
      userId: 'authenticated-user',
      refreshTokenHash: await bcrypt.hash(refreshToken, 4),
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: undefined as Date | undefined,
    };
    const sessions = {
      findActive: jest.fn(async (tokenId: string) => {
        if (
          tokenId === session.tokenId &&
          !session.revokedAt &&
          session.expiresAt.getTime() > Date.now()
        ) {
          return session;
        }
        return null;
      }),
      revokeUserSession: jest.fn(async (userId: string, sessionId: string) => {
        if (
          userId !== session.userId ||
          sessionId !== session.id ||
          session.revokedAt ||
          session.expiresAt.getTime() <= Date.now()
        ) {
          return false;
        }
        session.revokedAt = new Date();
        return true;
      }),
    };
    const jwt = {
      verifyAsync: jest.fn().mockResolvedValue({ sub: session.userId, tid: session.tokenId }),
    };
    const users = {
      findById: jest.fn().mockResolvedValue({
        id: session.userId,
        email: 'customer@example.com',
        isActive: true,
      }),
    };
    const audit = { append: jest.fn() };
    const authService = new AuthService(
      jwt as never,
      {} as never,
      users as never,
      {} as never,
      sessions as never,
      audit as never,
      {} as never,
      {} as never,
    );
    const revokeSession = new RevokeSessionService(sessions as never, audit as never);

    await revokeSession.execute({ userId: session.userId, sessionId: session.id });

    expect(session.revokedAt).toEqual(expect.any(Date));
    await expect(sessions.findActive(session.tokenId)).resolves.toBeNull();

    try {
      await authService.refresh(refreshToken);
      throw new Error('Expected revoked refresh token to be rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(UnauthorizedException);
      expect((error as UnauthorizedException).getResponse()).toEqual(
        expect.objectContaining({ code: 'INVALID_REFRESH_TOKEN' }),
      );
    }
  });
});
