import { ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { OAuth2Client, TokenPayload } from 'google-auth-library';
import { USER_REPOSITORY, UserRecord, UserRepository } from '../../users/domain/user.repository';
import {
  ORGANIZATION_REPOSITORY,
  OrganizationRepository,
} from '../../organizations/domain/organization.repository';
import { OrganizationRole, OrganizationType } from '../../organizations/domain/organization.types';
import { AUDIT_REPOSITORY, AuditRepository } from '../../audit/domain/audit.repository';
import { SESSION_REPOSITORY, SessionRepository } from '../domain/session.repository';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly organizations: OrganizationRepository,
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
  ) {}

  async register(email: string, password: string, fullName: string): Promise<AuthTokens> {
    const normalizedEmail = email.trim().toLowerCase();
    if (await this.users.findByEmail(normalizedEmail)) {
      throw new ConflictException({
        code: 'EMAIL_ALREADY_REGISTERED',
        message: 'Email is already registered',
      });
    }
    const user = await this.users.create({
      email: normalizedEmail,
      passwordHash: await bcrypt.hash(password, 12),
      fullName: fullName.trim(),
    });
    const organization = await this.organizations.create({
      name: `${user.fullName}'s Organization`,
      type: OrganizationType.SELF_SERVICE,
      members: [{ userId: user.id, role: OrganizationRole.OWNER }],
    });
    await this.audit.append({
      actorUserId: user.id,
      organizationId: organization.id,
      action: 'USER_REGISTERED',
      resourceType: 'USER',
      resourceId: user.id,
    });
    return this.createSessionTokens(user);
  }

  async login(email: string, password: string): Promise<AuthTokens> {
    const user = await this.users.findByEmail(email.trim().toLowerCase());
    if (
      !user ||
      !user.isActive ||
      !user.passwordHash ||
      !(await bcrypt.compare(password, user.passwordHash))
    ) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      });
    }
    await this.audit.append({
      actorUserId: user.id,
      action: 'USER_LOGIN',
      resourceType: 'USER',
      resourceId: user.id,
    });
    return this.createSessionTokens(user);
  }

  async loginWithGoogle(idToken: string): Promise<AuthTokens> {
    const payload = await this.verifyGoogleIdToken(idToken);
    const email = (payload.email ?? '').trim().toLowerCase();

    let user = await this.users.findByEmail(email);
    if (!user) {
      user = await this.users.create({
        email,
        fullName: payload.name?.trim() || email.split('@')[0],
      });
      const organization = await this.organizations.create({
        name: `${user.fullName}'s Organization`,
        type: OrganizationType.SELF_SERVICE,
        members: [{ userId: user.id, role: OrganizationRole.OWNER }],
      });
      await this.audit.append({
        actorUserId: user.id,
        organizationId: organization.id,
        action: 'USER_REGISTERED_GOOGLE',
        resourceType: 'USER',
        resourceId: user.id,
      });
    } else {
      if (!user.isActive) {
        throw new UnauthorizedException({
          code: 'INVALID_CREDENTIALS',
          message: 'Account is inactive',
        });
      }
      await this.audit.append({
        actorUserId: user.id,
        action: 'USER_LOGIN_GOOGLE',
        resourceType: 'USER',
        resourceId: user.id,
      });
    }

    return this.createSessionTokens(user);
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const payload = await this.verifyRefresh(refreshToken);
    const session = await this.sessions.findActive(payload.tid);
    if (
      !session ||
      session.userId !== payload.sub ||
      !(await bcrypt.compare(refreshToken, session.refreshTokenHash))
    ) {
      throw new UnauthorizedException({
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Refresh token is invalid or revoked',
      });
    }
    const user = await this.users.findById(payload.sub);
    if (!user || !user.isActive) {
      throw new UnauthorizedException({
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Refresh token is invalid or revoked',
      });
    }
    await this.sessions.revoke(session.id);
    return this.createSessionTokens(user);
  }

  async logout(refreshToken: string): Promise<void> {
    try {
      const payload = await this.verifyRefresh(refreshToken);
      const session = await this.sessions.findActive(payload.tid);
      if (session) await this.sessions.revoke(session.id);
    } catch {
      // Logout is idempotent and never reveals token validity.
    }
  }

  async me(userId: string): Promise<Omit<UserRecord, 'passwordHash' | 'mfa'>> {
    const user = await this.users.findById(userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'User is unavailable' });
    }
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      isPlatformAdmin: user.isPlatformAdmin,
      isActive: user.isActive,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  private async createSessionTokens(user: UserRecord): Promise<AuthTokens> {
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

  private async verifyRefresh(token: string): Promise<{ sub: string; tid: string }> {
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

  private async verifyGoogleIdToken(idToken: string): Promise<TokenPayload> {
    const clientId = this.config.getOrThrow<string>('GOOGLE_CLIENT_ID');
    if (!clientId) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Google sign-in is not configured',
      });
    }
    try {
      const ticket = await new OAuth2Client().verifyIdToken({ idToken, audience: clientId });
      const payload = ticket.getPayload();
      if (!payload || payload.aud !== clientId || !payload.email_verified || !payload.email) {
        throw new UnauthorizedException({
          code: 'INVALID_CREDENTIALS',
          message: 'Google token is invalid',
        });
      }
      return payload;
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Google token could not be verified',
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
