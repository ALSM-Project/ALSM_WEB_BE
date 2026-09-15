import { Inject, Injectable } from '@nestjs/common';
import { SESSION_REPOSITORY, SessionRepository } from '../domain/session.repository';
import { ActiveSession } from './session-management.types';

@Injectable()
export class ListActiveSessionsService {
  constructor(@Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository) {}

  async execute(userId: string): Promise<ActiveSession[]> {
    const sessions = await this.sessions.findActiveByUserId(userId);

    return sessions.map((session) => ({
      id: session.id,
      deviceType: session.deviceType ?? 'Unknown',
      browser: session.browser ?? 'Unknown',
      lastActiveAt:
        session.lastActiveAt ?? session.updatedAt ?? session.createdAt ?? session.expiresAt,
      createdAt: session.createdAt ?? session.expiresAt,
      expiresAt: session.expiresAt,
    }));
  }
}
