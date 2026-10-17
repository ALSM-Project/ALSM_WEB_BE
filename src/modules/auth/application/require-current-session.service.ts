import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { SESSION_REPOSITORY, SessionRepository } from '../domain/session.repository';
import { USER_REPOSITORY, UserRepository } from '../../users/domain/user.repository';

/** Ordinary live-session prerequisite only; NOT command MFA or support-session admission. */
@Injectable()
export class RequireCurrentSessionService {
  constructor(
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
  ) {}
  async execute(userId: string, sessionId?: string): Promise<void> {
    const denied = () =>
      new UnauthorizedException({
        code: 'CURRENT_SESSION_REQUIRED',
        message: 'A current active session for this account is required',
      });
    if (!/^[a-f0-9]{24}$/.test(userId) || !sessionId || !/^[a-f0-9]{24}$/.test(sessionId))
      throw denied();
    try {
      const account = await this.users.findById(userId);
      if (!account?.isActive || account.mustChangePassword) throw denied();
      const matching = (await this.sessions.findActiveByUserId(userId)).find(
        (session) => session.id === sessionId,
      );
      if (
        !matching ||
        matching.userId !== userId ||
        matching.revokedAt ||
        !Number.isFinite(matching.expiresAt.getTime()) ||
        matching.expiresAt.getTime() <= Date.now()
      )
        throw denied();
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new ServiceUnavailableException({
        code: 'SESSION_ASSURANCE_UNAVAILABLE',
        message: 'Session state could not be verified',
      });
    }
  }
}
