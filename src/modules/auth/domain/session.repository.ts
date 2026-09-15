export interface SessionRecord {
  id: string;
  tokenId: string;
  userId: string;
  refreshTokenHash: string;
  expiresAt: Date;
  revokedAt?: Date;
  deviceType?: string;
  browser?: string;
  lastActiveAt?: Date;
  userAgent?: string;
  ipAddress?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface SessionRepository {
  create(input: Omit<SessionRecord, 'id' | 'revokedAt'>): Promise<SessionRecord>;
  findActive(tokenId: string): Promise<SessionRecord | null>;
  findActiveByUserId(userId: string): Promise<SessionRecord[]>;
  updateTokenHash(id: string, hash: string): Promise<void>;
  revoke(id: string): Promise<void>;
  revokeUserSession(userId: string, sessionId: string): Promise<boolean>;
  revokeAllOther(userId: string, currentTokenId: string): Promise<void>;
}

export const SESSION_REPOSITORY = Symbol('SESSION_REPOSITORY');

