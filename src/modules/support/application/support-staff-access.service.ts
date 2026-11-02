import { ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { RequireCurrentSessionService } from '../../auth/application/require-current-session.service';
import { SESSION_REPOSITORY, SessionRepository } from '../../auth/domain/session.repository';
import {
  SUPPORT_STAFF_AUTHORITY,
  SupportStaffAuthorityPort,
} from '../../rbac/domain/support-staff-authority.port';
import { SupportPrincipal } from './support-context.ports';
import { supportDenied, supportUnavailable } from './support-context.errors';
import { isValidDate } from '../../../shared/utils/date.util';

export interface SupportAdmission {
  actorUserId: string;
  originalSessionId: string;
  sessionVersion: string;
  authorityBinding: string;
  expiresAt: Date;
}

/** Public ordinary session assurance plus persisted, exact support role/permission evidence. */
@Injectable()
export class SupportStaffAccessService {
  constructor(
    private readonly current: RequireCurrentSessionService,
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    @Inject(SUPPORT_STAFF_AUTHORITY) private readonly authority: SupportStaffAuthorityPort,
  ) {}

  async require(principal: SupportPrincipal, now: Date): Promise<SupportAdmission> {
    if (!isValidDate(now)) throw supportUnavailable();
    // Capture once: mutable callers must not swap the subject after an await.
    const { userId, sessionId, sessionVersion } = principal;
    await this.current.execute(userId, sessionId, sessionVersion);
    try {
      const matches = (await this.sessions.findActiveByUserId(userId)).filter(
        (row) => row.id === sessionId,
      );
      if (
        matches.length !== 1 ||
        matches[0].userId !== userId ||
        matches[0].accessVersion !== sessionVersion ||
        matches[0].revokedAt ||
        !isValidDate(matches[0].expiresAt) ||
        matches[0].expiresAt.getTime() <= now.getTime()
      )
        throw new UnauthorizedException({
          code: 'CURRENT_SESSION_REQUIRED',
          message: 'A current active session is required',
        });
      const authority = await this.authority.current(userId, now);
      if (!authority || !/^[a-f0-9]{64}$/.test(authority.binding)) throw supportDenied();
      const expiresAt = new Date(
        Math.min(matches[0].expiresAt.getTime(), authority.expiresAt?.getTime() ?? Infinity),
      );
      if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime())
        throw supportDenied();
      return {
        actorUserId: userId,
        originalSessionId: sessionId!,
        sessionVersion: sessionVersion!,
        authorityBinding: authority.binding,
        expiresAt,
      };
    } catch (error) {
      if (error instanceof UnauthorizedException || error instanceof ForbiddenException)
        throw error;
      throw supportUnavailable();
    }
  }

  async recheck(principal: SupportPrincipal, expected: SupportAdmission, now: Date): Promise<void> {
    const current = await this.require(principal, now);
    if (
      current.actorUserId !== expected.actorUserId ||
      current.originalSessionId !== expected.originalSessionId ||
      current.sessionVersion !== expected.sessionVersion ||
      current.authorityBinding !== expected.authorityBinding
    )
      throw supportDenied();
  }
}
