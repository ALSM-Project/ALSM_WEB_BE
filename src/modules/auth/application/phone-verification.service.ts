import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomBytes, randomInt } from 'crypto';
import * as bcrypt from 'bcrypt';

import { SMS_VERIFICATION_PORT, type SmsVerificationPort } from '../domain/sms-verification.port';
import {
  PHONE_VERIFICATION_REPOSITORY,
  type PhoneVerificationRepository,
} from '../domain/phone-verification.repository';

/* ── Constants ─────────────────────────────────────────────────────── */

/** OTP is valid for 5 minutes. */
const OTP_TTL_MS = 5 * 60 * 1000;

/** Minimum wait between two OTP requests for the same user+phone. */
const OTP_COOLDOWN_MS = 60 * 1000;

/** Maximum OTP requests per user+phone within the rate-limit window. */
const MAX_REQUESTS_PER_WINDOW = 3;

/** Rate-limit window. */
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

/** Maximum daily OTP requests per user+phone. */
const MAX_REQUESTS_PER_DAY = 10;

/** Lock out after this many consecutive failed verifications. */
const MAX_FAILED_ATTEMPTS = 5;

/** Bcrypt salt rounds for OTP code hashing. */
const BCRYPT_SALT_ROUNDS = 10;

/* ── Service ───────────────────────────────────────────────────────── */

@Injectable()
export class PhoneVerificationService {
  private readonly logger = new Logger(PhoneVerificationService.name);

  constructor(
    @Inject(SMS_VERIFICATION_PORT)
    private readonly smsPort: SmsVerificationPort,
    @Inject(PHONE_VERIFICATION_REPOSITORY)
    private readonly repo: PhoneVerificationRepository,
  ) {}

  /* ── Request OTP ───────────────────────────────────────────────── */

  /**
   * Generate a 6-digit OTP code, hash it, store the record and deliver via
   * SMS.  Enforces per-user+phone rate limits and cooldowns.
   */
  async requestOtp(
    userId: string,
    phone: string,
  ): Promise<{ sent: boolean; retryAfterSeconds: number }> {
    // ── Rate limit: per 10-minute window ──
    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
    const recentCount = await this.repo.countRecentByUserPhone(userId, phone, windowStart);
    if (recentCount >= MAX_REQUESTS_PER_WINDOW) {
      throw new BadRequestException({
        code: 'PHONE_OTP_RATE_LIMITED',
        message: 'Too many OTP requests. Please wait before trying again.',
      });
    }

    // ── Rate limit: per day ──
    const dayStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const dailyCount = await this.repo.countRecentByUserPhone(userId, phone, dayStart);
    if (dailyCount >= MAX_REQUESTS_PER_DAY) {
      throw new BadRequestException({
        code: 'PHONE_OTP_DAILY_LIMIT',
        message: 'Daily OTP limit reached. Please try again tomorrow.',
      });
    }

    // ── Cooldown: minimum interval between requests ──
    const existing = await this.repo.findLatestActive(userId, phone);
    if (existing) {
      const elapsed = Date.now() - existing.createdAt.getTime();
      if (elapsed < OTP_COOLDOWN_MS) {
        const retryAfterSeconds = Math.ceil((OTP_COOLDOWN_MS - elapsed) / 1000);
        return { sent: false, retryAfterSeconds };
      }
    }

    // ── Revoke previous active records ──
    await this.repo.revokeAllForUserPhone(userId, phone);

    // ── Generate OTP + token ──
    const code = randomInt(100_000, 1_000_000).toString();
    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const codeHash = await bcrypt.hash(code, BCRYPT_SALT_ROUNDS);

    // ── Persist record ──
    await this.repo.create({
      userId,
      phone,
      tokenHash,
      codeHash,
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    });

    // ── Send SMS ──
    try {
      await this.smsPort.sendOtp({
        phone,
        code,
        purpose: 'xác minh số điện thoại',
      });
    } catch (error) {
      this.logger.error(
        `SMS delivery failed for user ${userId} (phone not logged)`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new ServiceUnavailableException({
        code: 'SMS_DELIVERY_FAILED',
        message: 'Unable to send verification SMS. Please try again later.',
      });
    }

    this.logger.log(`Phone OTP sent for user ${userId}`);
    return { sent: true, retryAfterSeconds: Math.ceil(OTP_COOLDOWN_MS / 1000) };
  }

  /* ── Verify OTP ────────────────────────────────────────────────── */

  /**
   * Verify a 6-digit OTP code against the latest active record.
   *
   * On success the record is consumed (single-winner conditional write) and
   * the method returns `true`.  The caller is responsible for updating the
   * contract access grant's `phoneVerificationStatus`.
   */
  async verifyOtp(userId: string, phone: string, code: string): Promise<boolean> {
    const record = await this.repo.findLatestActive(userId, phone);

    if (!record) {
      throw new BadRequestException({
        code: 'PHONE_OTP_NOT_FOUND',
        message: 'No active verification code found. Please request a new one.',
      });
    }

    // ── Brute-force lockout ──
    if (record.failedAttempts >= MAX_FAILED_ATTEMPTS) {
      throw new BadRequestException({
        code: 'PHONE_OTP_LOCKED',
        message:
          'Too many incorrect attempts. This code has been locked. Please request a new one.',
      });
    }

    // ── Expiry check ──
    if (record.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException({
        code: 'PHONE_OTP_EXPIRED',
        message: 'Verification code has expired. Please request a new one.',
      });
    }

    // ── Compare OTP (bcrypt — constant-time by design) ──
    const isMatch = await bcrypt.compare(code, record.codeHash);

    if (!isMatch) {
      const newCount = await this.repo.incrementFailedAttempts(record.id);
      this.logger.warn(
        `Phone OTP verification failed for user ${userId} (attempt ${newCount}/${MAX_FAILED_ATTEMPTS})`,
      );
      throw new BadRequestException({
        code: 'PHONE_OTP_INVALID',
        message: 'Invalid verification code.',
      });
    }

    // ── Consume (single-winner) ──
    const consumed = await this.repo.consumeActive(record.id, userId);
    if (!consumed) {
      throw new BadRequestException({
        code: 'PHONE_OTP_ALREADY_USED',
        message: 'This verification code has already been used. Please request a new one.',
      });
    }

    this.logger.log(`Phone verified for user ${userId}`);
    return true;
  }

  /* ── Status query ──────────────────────────────────────────────── */

  /**
   * Check whether the user has a pending (active, unexpired) OTP for the
   * given phone.  This does NOT check the grant — the caller should combine
   * this with the grant's `phoneVerificationStatus` for the full picture.
   */
  async hasActiveOtp(userId: string, phone: string): Promise<boolean> {
    const record = await this.repo.findLatestActive(userId, phone);
    return record !== null;
  }
}

