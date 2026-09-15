import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AUDIT_REPOSITORY, AuditRepository } from '../../audit/domain/audit.repository';
import { SESSION_REPOSITORY, SessionRepository } from '../domain/session.repository';
import { RevokeSessionInput } from './session-management.types';

@Injectable()
export class RevokeSessionService {
  constructor(
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
  ) {}

  async execute(input: RevokeSessionInput): Promise<void> {
    const revoked = await this.sessions.revokeUserSession(input.userId, input.sessionId);
    if (!revoked) {
      throw new NotFoundException({
        code: 'SESSION_NOT_FOUND',
        message: 'Session not found or no longer active',
      });
    }

    await this.audit.append({
      actorUserId: input.userId,
      action: 'USER_SESSION_REVOKED',
      resourceType: 'USER_SESSION',
      resourceId: input.sessionId,
    });
  }
}
