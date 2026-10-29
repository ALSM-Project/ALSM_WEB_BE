import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, randomInt } from 'crypto';
import { isAccountAdmitted } from '../domain/account-admission';
import { USER_REPOSITORY, UserRecord, UserRepository } from '../../users/domain/user.repository';
import { EMAIL_PORT, EmailPort } from '../domain/email.port';
import {
  EMAIL_VERIFICATION_REPOSITORY,
  EmailVerificationRepository,
} from '../domain/email-verification.repository';

const VERIFICATION_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

@Injectable()
export class EmailVerificationService {
  constructor(
    private readonly config: ConfigService,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(EMAIL_PORT) private readonly email: EmailPort,
    @Inject(EMAIL_VERIFICATION_REPOSITORY)
    private readonly emailVerifications: EmailVerificationRepository,
  ) {}

  async sendVerificationEmail(user: UserRecord): Promise<void> {
    const plainToken = randomBytes(32).toString('hex');
    const tokenHash = hashToken(plainToken);
    const code = randomInt(100000, 1000000).toString();

    await this.emailVerifications.revokeAllForUser(user.id);
    await this.emailVerifications.create({
      userId: user.id,
      tokenHash,
      code,
      expiresAt: new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS),
    });

    const verifyUrl = this.buildVerifyUrl(plainToken, user.email);

    await this.email.send({
      to: user.email,
      subject: 'Verify your ALSM Account Email',
      html:
        `<p>Hi ${this.escape(user.fullName)},</p>` +
        `<p>Thank you for creating an account with ALSM Platform. Please verify your email address to complete registration.</p>` +
        `<p>Your 6-digit Verification Code is: <strong style="font-size: 20px; letter-spacing: 4px; color: #0652CC;">${code}</strong></p>` +
        `<p>Or click the link below to verify your email automatically (valid for 15 minutes):</p>` +
        `<p><a href="${verifyUrl}">${verifyUrl}</a></p>` +
        `<p>If you did not sign up for an ALSM account, please ignore this email.</p>`,
      text: `Hi ${user.fullName}, verify your email. Code: ${code}. Link: ${verifyUrl}`,
    });
  }

  async verify(email: string, tokenOrCode: string): Promise<UserRecord> {
    const invalid = () =>
      new BadRequestException({
        code: 'INVALID_VERIFICATION_CODE',
        message: 'Verification could not be completed. Sign in or request a new verification code.',
      });
    if (typeof email !== 'string' || typeof tokenOrCode !== 'string') throw invalid();
    const normalizedEmail = email.trim().toLowerCase();
    const cleanInput = tokenOrCode.trim();
    if (!/^(?:\d{6}|[a-f0-9]{64})$/.test(cleanInput)) throw invalid();
    try {
      const user = await this.users.findByEmail(normalizedEmail);
      // Verified state is not proof. This route also has no second-factor challenge.
      if (
        !user ||
        user.email !== normalizedEmail ||
        !/^[a-f0-9]{24}$/.test(user.id) ||
        !isAccountAdmitted(user) ||
        user.isEmailVerified !== false ||
        user.mfa?.enabled !== false
      )
        throw invalid();
      const record = await this.emailVerifications.findLatestActiveByUserId(user.id);
      if (
        !record ||
        record.userId !== user.id ||
        !/^[a-f0-9]{24}$/.test(record.id) ||
        record.consumedAt !== undefined ||
        !Number.isFinite(record.expiresAt?.getTime()) ||
        record.expiresAt.getTime() <= Date.now()
      )
        throw invalid();
      const matchesCode = /^\d{6}$/.test(cleanInput) && record.code === cleanInput;
      const matchesToken =
        /^[a-f0-9]{64}$/.test(cleanInput) && record.tokenHash === hashToken(cleanInput);
      if (!matchesCode && !matchesToken) throw invalid();
      if (
        !(await this.emailVerifications.consumeActive({
          id: record.id,
          userId: user.id,
          tokenHash: record.tokenHash,
          code: record.code,
        }))
      )
        throw invalid();
      // A second conditional write prevents separate concurrent proofs from both
      // authorizing the same unverified -> verified transition. Never retry it.
      const verified = await this.users.markEmailVerifiedIfUnverified(user.id, normalizedEmail);
      if (
        !verified ||
        verified.id !== user.id ||
        verified.email !== normalizedEmail ||
        verified.isEmailVerified !== true ||
        !isAccountAdmitted(verified) ||
        verified.mfa?.enabled !== false
      )
        throw invalid();
      return verified;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new ServiceUnavailableException({
        code: 'EMAIL_VERIFICATION_UNAVAILABLE',
        message: 'Email verification could not be confirmed. Please try again.',
      });
    }
  }

  async resendVerification(email: string): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.users.findByEmail(normalizedEmail);
    if (user && !user.isEmailVerified) {
      await this.sendVerificationEmail(user);
    }
  }

  private buildVerifyUrl(plainToken: string, email: string): string {
    const base = this.config.get<string>('APP_BASE_URL') || 'http://localhost:5173';
    return `${base.replace(/\/+$/, '')}/verify-email?token=${encodeURIComponent(plainToken)}&email=${encodeURIComponent(email)}`;
  }

  private escape(value: string): string {
    return value.replace(/[&<>"']/g, (c) => {
      const map: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      };
      return map[c];
    });
  }
}

function hashToken(plainToken: string): string {
  return createHash('sha256').update(plainToken).digest('hex');
}
