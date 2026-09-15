export interface ActiveSession {
  id: string;
  deviceType: string;
  browser: string;
  lastActiveAt: Date;
  createdAt: Date;
  expiresAt: Date;
}

export interface RevokeSessionInput {
  userId: string;
  sessionId: string;
}
