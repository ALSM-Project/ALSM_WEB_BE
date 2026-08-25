import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { SESSION_REPOSITORY, SessionRepository } from '../domain/session.repository';
import { UserRecord } from '../../users/domain/user.repository';
import { AuthTokens } from './auth-tokens';

@Injectable()
export class AuthTokenIssuerService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
  ) {}

  async issue(user: UserRecord): Promise<AuthTokens> {
    const tokenId = randomUUID();
    const expiresAt = new Date(Date.now() + this.durationMs('JWT_REFRESH_EXPIRES_IN'));
    const session = await this.sessions.create({
      tokenId,
      userId: user.id,
      refreshTokenHash: 'pending',
      expiresAt,
    });

    const accessToken = await this.jwt.signAsync(
      { sub: user.id, email: user.email, isPlatformAdmin: user.isPlatformAdmin },
      {
        secret: this.config.getOrThrow('JWT_ACCESS_SECRET'),
        expiresIn: this.durationSeconds('JWT_ACCESS_EXPIRES_IN'),
      },
    );
    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, tid: tokenId },
      {
        secret: this.config.getOrThrow('JWT_REFRESH_SECRET'),
        expiresIn: this.durationSeconds('JWT_REFRESH_EXPIRES_IN'),
      },
    );

    await this.sessions.updateTokenHash(session.id, await bcrypt.hash(refreshToken, 12));
    return { accessToken, refreshToken };
  }

  async verifyRefreshToken(token: string): Promise<{ sub: string; tid: string }> {
    try {
      return await this.jwt.verifyAsync<{ sub: string; tid: string }>(token, {
        secret: this.config.getOrThrow('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException({
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Refresh token is invalid or expired',
      });
    }
  }

  private durationSeconds(key: string): number {
    return Math.floor(this.durationMs(key) / 1000);
  }

  private durationMs(key: string): number {
    const value = this.config.getOrThrow<string>(key);
    const match = /^(\d+)([smhd])$/.exec(value);
    if (!match) throw new Error(`${key} must use a simple duration such as 15m`);
    const units: Record<string, number> = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
    return Number(match[1]) * units[match[2]];
  }
}
