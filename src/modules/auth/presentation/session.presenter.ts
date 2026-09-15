import { ActiveSession } from '../application/session-management.types';

export class SessionPresenter {
  static toResponse(session: ActiveSession) {
    return {
      id: session.id,
      deviceType: session.deviceType,
      browser: session.browser,
      lastActiveAt: session.lastActiveAt.toISOString(),
      createdAt: session.createdAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
    };
  }

  static toResponseList(sessions: ActiveSession[]) {
    return sessions.map((session) => this.toResponse(session));
  }
}
