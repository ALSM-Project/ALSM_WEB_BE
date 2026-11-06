/**
 * Repository contract for phone-verification OTP records.
 *
 * Follows the same pattern as {@link EmailVerificationRepository}: records are
 * created with a hashed token, consumed exactly once via a conditional write,
 * and expired by a TTL index on {@link PhoneVerificationRecord.expiresAt}.
 */
export interface PhoneVerificationRecord {
  readonly id: string;
  readonly userId: string;
  readonly phone: string;
  /** SHA-256 hex digest of the raw token (never stored in plain text). */
  readonly tokenHash: string;
  /** 6-digit OTP code.  Stored hashed (bcrypt) — plain text never persisted. */
  readonly codeHash: string;
  readonly expiresAt: Date;
  readonly consumedAt?: Date;
  readonly createdAt: Date;
  /** Number of failed verification attempts against this record. */
  readonly failedAttempts: number;
}

export interface CreatePhoneVerificationInput {
  readonly userId: string;
  readonly phone: string;
  readonly tokenHash: string;
  readonly codeHash: string;
  readonly expiresAt: Date;
}

export interface PhoneVerificationRepository {
  /** Create a new verification record. */
  create(input: CreatePhoneVerificationInput): Promise<PhoneVerificationRecord>;

  /** Find the latest unconsumed, unexpired record for a given user+phone. */
  findLatestActive(userId: string, phone: string): Promise<PhoneVerificationRecord | null>;

  /**
   * Atomically consume the record only if it is still active and unexpired.
   * Returns `true` if the conditional write succeeded (single-winner).
   */
  consumeActive(id: string, userId: string): Promise<boolean>;

  /** Increment the failed-attempts counter.  Returns the new count. */
  incrementFailedAttempts(id: string): Promise<number>;

  /** Revoke (consume) all active records for a user+phone pair. */
  revokeAllForUserPhone(userId: string, phone: string): Promise<void>;

  /**
   * Count how many records were created for the given user+phone within the
   * specified window.  Used for rate-limiting.
   */
  countRecentByUserPhone(userId: string, phone: string, since: Date): Promise<number>;
}

export const PHONE_VERIFICATION_REPOSITORY = Symbol('PHONE_VERIFICATION_REPOSITORY');

