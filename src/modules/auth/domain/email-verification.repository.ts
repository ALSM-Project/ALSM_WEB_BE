export interface EmailVerificationRecord {
  id: string;
  userId: string;
  tokenHash: string;
  code: string;
  expiresAt: Date;
  consumedAt?: Date;
}

export interface EmailVerificationRepository {
  create(input: { userId: string; tokenHash: string; code: string; expiresAt: Date }): Promise<EmailVerificationRecord>;
  findLatestActiveByUserId(userId: string): Promise<EmailVerificationRecord | null>;
  markConsumed(id: string): Promise<void>;
  revokeAllForUser(userId: string): Promise<void>;
}

export const EMAIL_VERIFICATION_REPOSITORY = Symbol('EMAIL_VERIFICATION_REPOSITORY');
