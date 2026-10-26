export interface SessionRecord {
  id: string;
  tokenId: string;
  userId: string;
  refreshTokenHash: string;
  /** Stable per-login browser lineage; refresh rotates proof on this same record. */
  familyId?: string;
  /** Binds an access JWT to the current refresh generation. */
  accessVersion?: string;
  /** One pre-upgrade proof retained ONLY for terminating its own lineage. */
  legacyTokenId?: string;
  legacyTokenHash?: string;
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
  rotateRefresh(input: RefreshRotation): Promise<boolean>;
  findForLogout(userId: string, tokenId: string): Promise<SessionRecord | null>;
  revokeBrowserSession(input: BrowserRevocation): Promise<void>;
  revokeAllOther(
    userId: string,
    currentSessionId: string,
  ): Promise<{ revokedCount: number } | null>;
}

export interface RefreshRotation {
  sessionId: string;
  userId: string;
  expectedTokenId: string;
  expectedTokenHash: string;
  successorTokenId: string;
  successorTokenHash: string;
  familyId: string;
  expiresAt: Date;
  lastActiveAt: Date;
  deviceType?: string;
  browser?: string;
  legacyProof?: boolean;
}

export interface BrowserRevocation {
  sessionId: string;
  userId: string;
  familyId?: string;
  legacyTokenId?: string;
}

/** Never expose driver details or retry an unconfirmed security write blindly. */
export class SessionPersistenceUnavailableError extends Error {
  constructor() {
    super('SESSION_PERSISTENCE_UNAVAILABLE');
  }
}

export const SESSION_REPOSITORY = Symbol('SESSION_REPOSITORY');
