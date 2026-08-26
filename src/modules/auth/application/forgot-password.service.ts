import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import { USER_REPOSITORY, UserRepository } from '../../users/domain/user.repository';
import { EMAIL_PORT, EmailPort } from '../domain/email.port';
import {
  PASSWORD_RESET_REPOSITORY,
  PasswordResetRepository,
} from '../domain/password-reset.repository';

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

@Injectable()
export class ForgotPasswordService {
  constructor(
    private readonly config: ConfigService,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(EMAIL_PORT) private readonly email: EmailPort,
    @Inject(PASSWORD_RESET_REPOSITORY)
    private readonly passwordResets: PasswordResetRepository,
  ) {}

  /**
   * Always respond successfully to avoid leaking whether an email exists.
   * If the email matches a user, issue a single-use reset token and email it.
   */
  async execute(email: string): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.users.findByEmail(normalizedEmail);

    if (user && user.isActive) {
      const plainToken = randomBytes(32).toString('hex');
      const tokenHash = hashToken(plainToken);
      await this.passwordResets.create({
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      });

      const resetUrl = this.buildResetUrl(plainToken);
      await this.email.send({
        to: user.email,
        subject: 'Reset your ALSM password',
        html:
          `<p>Hi ${this.escape(user.fullName)},</p>` +
          `<p>We received a request to reset your password. Click the link below to choose a new one (valid for 30 minutes):</p>` +
          `<p><a href="${resetUrl}">${resetUrl}</a></p>` +
          `<p>If you did not request this, you can safely ignore this email.</p>`,
        text: `Hi ${user.fullName}, reset your password here: ${resetUrl}`,
      });
    }
  }

  private buildResetUrl(plainToken: string): string {
    const base = this.config.get<string>('APP_BASE_URL') || 'http://localhost:5173';
    return `${base.replace(/\/+$/, '')}/reset-password?token=${encodeURIComponent(plainToken)}`;
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

/** Deterministic hash so the reset link matches the stored hash (bcrypt's random salt would break lookups). */
function hashToken(plainToken: string): string {
  return createHash('sha256').update(plainToken).digest('hex');
}
