import { ActiveSession } from '../application/session-management.types';

export class SessionPresenter {
  static toResponse(session: ActiveSession, currentSessionId?: string) {
    return {
      id: session.id,
      deviceType: session.deviceType,
      browser: session.browser,
      lastActiveAt: session.lastActiveAt.toISOString(),
      createdAt: session.createdAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      isCurrent: session.id === currentSessionId,
    };
  }

  static toResponseList(sessions: ActiveSession[], currentSessionId?: string) {
    return sessions.map((session) => this.toResponse(session, currentSessionId));
  }
}
