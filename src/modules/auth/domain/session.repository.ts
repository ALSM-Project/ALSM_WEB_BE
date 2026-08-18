export interface SessionRecord { id: string; tokenId: string; userId: string; refreshTokenHash: string; expiresAt: Date; revokedAt?: Date; }
export interface SessionRepository { create(input: Omit<SessionRecord, 'id' | 'revokedAt'>): Promise<SessionRecord>; findActive(tokenId: string): Promise<SessionRecord | null>; updateTokenHash(id: string, hash: string): Promise<void>; revoke(id: string): Promise<void>; }
export const SESSION_REPOSITORY = Symbol('SESSION_REPOSITORY');
