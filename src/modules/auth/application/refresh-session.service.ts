import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { USER_REPOSITORY, UserRepository } from '../../users/domain/user.repository';
import { SESSION_REPOSITORY, SessionRepository } from '../domain/session.repository';
import { AuthTokenIssuerService } from './auth-token-issuer.service';
import { AuthTokens } from './auth-tokens';

@Injectable()
export class RefreshSessionService {
  constructor(
    private readonly tokens: AuthTokenIssuerService,
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
  ) {}

  async execute(input: { refreshToken: string }): Promise<AuthTokens> {
    const payload = await this.tokens.verifyRefreshToken(input.refreshToken);
    const session = await this.sessions.findActive(payload.tid);
    if (
      !session ||
      session.userId !== payload.sub ||
      !(await bcrypt.compare(input.refreshToken, session.refreshTokenHash))
    ) {
      throw new UnauthorizedException({
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Refresh token is invalid or revoked',
      });
    }

    const user = await this.users.findById(payload.sub);
    if (!user || !user.isActive) {
      throw new UnauthorizedException({
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Refresh token is invalid or revoked',
      });
    }

    await this.sessions.revoke(session.id);
    return this.tokens.issue(user);
  }
}
