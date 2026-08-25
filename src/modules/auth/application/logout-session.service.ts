import { Inject, Injectable } from '@nestjs/common';
import { SESSION_REPOSITORY, SessionRepository } from '../domain/session.repository';
import { AuthTokenIssuerService } from './auth-token-issuer.service';

@Injectable()
export class LogoutSessionService {
  constructor(
    private readonly tokens: AuthTokenIssuerService,
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
  ) {}

  async execute(input: { refreshToken: string }): Promise<void> {
    try {
      const payload = await this.tokens.verifyRefreshToken(input.refreshToken);
      const session = await this.sessions.findActive(payload.tid);
      if (session) await this.sessions.revoke(session.id);
    } catch {
      // Logout is idempotent and never reveals token validity.
    }
  }
}
