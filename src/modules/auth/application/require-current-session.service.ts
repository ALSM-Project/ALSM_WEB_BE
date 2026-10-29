import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { SESSION_REPOSITORY, SessionRepository } from '../domain/session.repository';
import { USER_REPOSITORY, UserRepository } from '../../users/domain/user.repository';
import { isAccountAdmitted } from '../domain/account-admission';

/** Ordinary live-session prerequisite only; NOT command MFA or support-session admission. */
@Injectable()
export class RequireCurrentSessionService {
  constructor(
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
  ) {}
  async execute(
    userId: string,
    sessionId?: string,
    version?: string,
    passwordRemediation = false,
  ): Promise<void> {
    const denied = () =>
      new UnauthorizedException({
        code: 'CURRENT_SESSION_REQUIRED',
        message: 'A current active session for this account is required',
      });
    if (
      typeof userId !== 'string' ||
      !/^[a-f0-9]{24}$/.test(userId) ||
      typeof sessionId !== 'string' ||
      !/^[a-f0-9]{24}$/.test(sessionId) ||
      typeof version !== 'string' ||
      !version ||
      version.length > 200
    )
      throw denied();
    try {
      const account = await this.users.findById(userId);
      if (
        !account ||
        account.id !== userId ||
        !isAccountAdmitted(account) ||
        (account.mustChangePassword && !passwordRemediation)
      )
        throw denied();
      const matching = (await this.sessions.findActiveByUserId(userId)).find(
        (session) => session.id === sessionId,
      );
      if (
        !matching ||
        matching.userId !== userId ||
        matching.accessVersion !== version ||
        matching.revokedAt ||
        !Number.isFinite(matching.expiresAt.getTime()) ||
        matching.expiresAt.getTime() <= Date.now()
      )
        throw denied();
      // A lock saved while session storage was being read must also deny admission.
      const current = await this.users.findById(userId);
      if (
        !current ||
        current.id !== userId ||
        !isAccountAdmitted(current) ||
        (current.mustChangePassword && !passwordRemediation)
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
