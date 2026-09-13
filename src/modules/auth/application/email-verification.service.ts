import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import { USER_REPOSITORY, UserRecord, UserRepository } from '../../users/domain/user.repository';
import { EMAIL_PORT, EmailPort } from '../domain/email.port';
import {
  EMAIL_VERIFICATION_REPOSITORY,
  EmailVerificationRepository,
} from '../domain/email-verification.repository';

const VERIFICATION_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

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
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    await this.emailVerifications.revokeAllForUser(user.id);
    await this.emailVerifications.create({
      userId: user.id,
      tokenHash,
      code,
      expiresAt: new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS),
    });

    const verifyUrl = this.buildVerifyUrl(plainToken, user.email);

    this.logger.log(`Email verification generated for ${user.email}: Code=${code}, Token=${plainToken}`);

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
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.users.findByEmail(normalizedEmail);
    if (!user) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'User account not found',
      });
    }

    if (user.isEmailVerified) {
      return user;
    }

    const record = await this.emailVerifications.findLatestActiveByUserId(user.id);
    if (!record) {
      throw new BadRequestException({
        code: 'INVALID_VERIFICATION_CODE',
        message: 'Verification code or link has expired or is invalid. Please request a new code.',
      });
    }

    const cleanInput = tokenOrCode.trim();
    const matchesCode = record.code === cleanInput;
    const matchesToken = record.tokenHash === hashToken(cleanInput);

    if (!matchesCode && !matchesToken) {
      throw new BadRequestException({
        code: 'INVALID_VERIFICATION_CODE',
        message: 'Invalid verification code or link.',
      });
    }

    await this.emailVerifications.markConsumed(record.id);
    await this.users.markEmailVerified(user.id);

    return {
      ...user,
      isEmailVerified: true,
    };
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
