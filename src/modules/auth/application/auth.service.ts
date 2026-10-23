import {
  ConflictException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
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
import { EffectivePermissionsService } from '../../rbac/application/effective-permissions.service';

import { EmailVerificationService } from './email-verification.service';
import { getSessionClientMetadata } from './session-client-metadata';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  mustChangePassword?: boolean;
  hasPassword?: boolean;
}

export interface RegisterResult {
  requiresEmailVerification: boolean;
  email: string;
  message: string;
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
    private readonly effectivePermissionsService: EffectivePermissionsService,
    private readonly emailVerificationService: EmailVerificationService,
  ) {}

  async register(email: string, password: string, fullName: string): Promise<RegisterResult> {
    const normalizedEmail = email.trim().toLowerCase();
    if (await this.users.findByEmail(normalizedEmail)) {
      throw new ConflictException({
        code: 'EMAIL_ALREADY_REGISTERED',
        message: 'Email is already registered',
      });
    }
    const user = await this.createUserCatchingDuplicate({
      email: normalizedEmail,
      passwordHash: await bcrypt.hash(password, 12),
      fullName: fullName.trim(),
      isEmailVerified: false,
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
    await this.emailVerificationService.sendVerificationEmail(user);
    return {
      requiresEmailVerification: true,
      email: user.email,
      message: 'Account created. Please check your email to verify your account.',
    };
  }

  async login(email: string, password: string, userAgent?: string): Promise<AuthTokens> {
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
    if (!user.isEmailVerified) {
      throw new UnauthorizedException({
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Email address is not verified. Please verify your email before logging in.',
      });
    }
    if (user.isLocked) {
      throw new UnauthorizedException({
        code: 'ACCOUNT_LOCKED',
        message: 'Your account has been locked. Please contact your administrator.',
      });
    }
    await this.audit.append({
      actorUserId: user.id,
      action: 'USER_LOGIN',
      resourceType: 'USER',
      resourceId: user.id,
    });
    return this.createSessionTokens(user, userAgent);
  }

  async verifyEmail(email: string, codeOrToken: string, userAgent?: string): Promise<AuthTokens> {
    const user = await this.emailVerificationService.verify(email, codeOrToken);
    await this.audit.append({
      actorUserId: user.id,
      action: 'USER_EMAIL_VERIFIED',
      resourceType: 'USER',
      resourceId: user.id,
    });
    return this.createSessionTokens(user, userAgent);
  }

  async resendVerification(email: string): Promise<void> {
    await this.emailVerificationService.resendVerification(email);
  }

  async loginWithGoogle(idToken: string, userAgent?: string): Promise<AuthTokens> {
    const payload = await this.verifyGoogleIdToken(idToken);
    const email = (payload.email ?? '').trim().toLowerCase();

    let user = await this.users.findByEmail(email);
    if (!user) {
      user = await this.createUserCatchingDuplicate({
        email,
        fullName: payload.name?.trim() || email.split('@')[0],
        isEmailVerified: true,
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
      if (!user.isEmailVerified) {
        await this.users.markEmailVerified(user.id);
      }
      await this.audit.append({
        actorUserId: user.id,
        action: 'USER_LOGIN_GOOGLE',
        resourceType: 'USER',
        resourceId: user.id,
      });
    }

    return this.createSessionTokens(user, userAgent);
  }

  async refresh(refreshToken: string, userAgent?: string): Promise<AuthTokens> {
    try {
      const payload = await this.verifyRefresh(refreshToken);
      const session = await this.sessions.findActive(payload.tid);
      if (
        !session ||
        !isSessionId(session.id) ||
        session.userId !== payload.sub ||
        session.tokenId !== payload.tid ||
        session.revokedAt ||
        !Number.isFinite(session.expiresAt?.getTime()) ||
        session.expiresAt.getTime() <= Date.now() ||
        typeof session.refreshTokenHash !== 'string' ||
        (payload.sid !== undefined &&
          (payload.sid !== session.id || payload.fid !== session.familyId))
      )
        throw invalidRefresh();
      let matches = false;
      try {
        matches = await bcrypt.compare(refreshToken, session.refreshTokenHash);
      } catch {
        /* Invalid stored proof is not authority. */
      }
      if (!matches) throw invalidRefresh();
      const user = await this.users.findById(payload.sub);
      if (!user || user.id !== payload.sub || !user.isActive) throw invalidRefresh();
      const tokenId = randomUUID();
      const familyId = session.familyId ?? randomUUID();
      const tokens = await this.signSessionTokens(user, session.id, tokenId, familyId);
      const rotated = await this.sessions.rotateRefresh({
        sessionId: session.id,
        userId: user.id,
        expectedTokenId: session.tokenId,
        expectedTokenHash: session.refreshTokenHash,
        successorTokenId: tokenId,
        successorTokenHash: await bcrypt.hash(tokens.refreshToken, 12),
        familyId,
        legacyProof: session.accessVersion === undefined,
        expiresAt: new Date(Date.now() + this.durationMs('JWT_REFRESH_EXPIRES_IN')),
        lastActiveAt: new Date(),
        ...getSessionClientMetadata(userAgent),
      });
      if (!rotated) throw invalidRefresh();
      // Only a confirmed single-document winner may publish its prepared credentials.
      return tokens;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new ServiceUnavailableException({
        code: 'REFRESH_UNAVAILABLE',
        message: 'Refresh could not be confirmed. Sign in again if necessary.',
      });
    }
  }

  async logout(refreshToken: string): Promise<void> {
    let proof: RefreshClaims;
    try {
      // Expired signed proof may ONLY terminate its own lineage, never refresh or authenticate.
      proof = await this.verifyRefresh(refreshToken, true);
    } catch {
      return;
    }
    try {
      if (proof.sid && proof.fid) {
        await this.sessions.revokeBrowserSession({
          userId: proof.sub,
          sessionId: proof.sid,
          familyId: proof.fid,
        });
        return;
      }
      const session = await this.sessions.findForLogout(proof.sub, proof.tid);
      if (!session) return;
      const hash =
        session.legacyTokenId === proof.tid ? session.legacyTokenHash : session.refreshTokenHash;
      let matches = false;
      try {
        matches = !!hash && (await bcrypt.compare(refreshToken, hash));
      } catch {
        /* Invalid proof remains idempotent. */
      }
      if (matches)
        await this.sessions.revokeBrowserSession({
          userId: proof.sub,
          sessionId: session.id,
          legacyTokenId: proof.tid,
        });
    } catch {
      throw new ServiceUnavailableException({
        code: 'SESSION_REVOCATION_UNAVAILABLE',
        message: 'Session revocation could not be confirmed. Please try again.',
      });
    }
  }

  async me(userId: string) {
    const user = await this.users.findById(userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'User is unavailable' });
    }

    const roles = await this.effectivePermissionsService.getUserRoles(userId);
    const effectivePermissions =
      await this.effectivePermissionsService.getEffectivePermissions(userId);

    const hasPassword = Boolean(user.passwordHash);
    const twoFactorEnabled = Boolean(user.mfa?.enabled);
    const providers: string[] = [];
    if (hasPassword) providers.push('PASSWORD');
    providers.push('GOOGLE');

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      isPlatformAdmin: user.isPlatformAdmin,
      roles,
      effectivePermissions,
      isActive: user.isActive,
      hasPassword,
      twoFactorEnabled,
      providers,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  async revokeAllOtherSessions(userId: string, currentSessionId?: string): Promise<void> {
    if (!isSessionId(userId) || !isSessionId(currentSessionId))
      throw new UnauthorizedException({
        code: 'CURRENT_SESSION_REQUIRED',
        message: 'A current session is required',
      });
    try {
      if (!(await this.sessions.revokeAllOther(userId, currentSessionId)))
        throw new UnauthorizedException({
          code: 'CURRENT_SESSION_REQUIRED',
          message: 'A current session is required',
        });
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new ServiceUnavailableException({
        code: 'SESSION_REVOCATION_UNAVAILABLE',
        message: 'Session revocation could not be confirmed. Please try again.',
      });
    }
  }

  private async createSessionTokens(user: UserRecord, userAgent?: string): Promise<AuthTokens> {
    const tokenId = randomUUID();
    const familyId = randomUUID();
    const sessionMetadata = getSessionClientMetadata(userAgent);
    const lastActiveAt = new Date();
    const expiresAt = new Date(Date.now() + this.durationMs('JWT_REFRESH_EXPIRES_IN'));
    const session = await this.sessions.create({
      tokenId,
      userId: user.id,
      refreshTokenHash: 'pending',
      familyId,
      accessVersion: tokenId,
      expiresAt,
      ...sessionMetadata,
      lastActiveAt,
    });
    const tokens = await this.signSessionTokens(user, session.id, tokenId, familyId);
    await this.sessions.updateTokenHash(session.id, await bcrypt.hash(tokens.refreshToken, 12));
    return tokens;
  }

  private async signSessionTokens(
    user: UserRecord,
    sessionId: string,
    tokenId: string,
    familyId: string,
  ): Promise<AuthTokens> {
    const accessToken = await this.jwt.signAsync(
      {
        sub: user.id,
        email: user.email,
        isPlatformAdmin: user.isPlatformAdmin,
        sid: sessionId,
        sv: tokenId,
      },
      {
        secret: this.config.getOrThrow('JWT_ACCESS_SECRET'),
        expiresIn: this.durationSeconds('JWT_ACCESS_EXPIRES_IN'),
      },
    );
    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, tid: tokenId, sid: sessionId, fid: familyId },
      {
        secret: this.config.getOrThrow('JWT_REFRESH_SECRET'),
        expiresIn: this.durationSeconds('JWT_REFRESH_EXPIRES_IN'),
      },
    );
    return {
      accessToken,
      refreshToken,
      mustChangePassword: user.mustChangePassword,
      hasPassword: Boolean(user.passwordHash),
    };
  }

  private async verifyRefresh(token: string, logoutOnly = false): Promise<RefreshClaims> {
    try {
      const payload = await this.jwt.verifyAsync<RefreshClaims>(token, {
        secret: this.config.getOrThrow('JWT_REFRESH_SECRET'),
        ignoreExpiration: logoutOnly,
      });
      if (
        !payload ||
        !isSessionId(payload.sub) ||
        typeof payload.tid !== 'string' ||
        !payload.tid ||
        payload.tid.length > 200 ||
        ((payload.sid !== undefined || payload.fid !== undefined) &&
          (!isSessionId(payload.sid) ||
            typeof payload.fid !== 'string' ||
            !payload.fid ||
            payload.fid.length > 200))
      )
        throw invalidRefresh();
      return payload;
    } catch {
      throw new UnauthorizedException({
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Refresh token is invalid or expired',
      });
    }
  }

  private async verifyGoogleIdToken(idToken: string): Promise<TokenPayload> {
    const clientId = this.config.get<string>('GOOGLE_CLIENT_ID') || '';
    if (!clientId) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Google sign-in is not configured on the backend',
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

  // The email field has a unique index, so a race between two concurrent
  // registrations can pass the findByEmail check above and still fail here
  // with a MongoDB E11000 duplicate-key error. Normalize that to a 409 so the
  // client sees EMAIL_ALREADY_REGISTERED instead of a generic 500.
  private async createUserCatchingDuplicate(
    input: Parameters<UserRepository['create']>[0],
  ): Promise<UserRecord> {
    try {
      return await this.users.create(input);
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        throw new ConflictException({
          code: 'EMAIL_ALREADY_REGISTERED',
          message: 'Email is already registered',
        });
      }
      throw err;
    }
  }
}

interface RefreshClaims {
  sub: string;
  tid: string;
  sid?: string;
  fid?: string;
}

function isSessionId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{24}$/.test(value);
}

function invalidRefresh(): UnauthorizedException {
  return new UnauthorizedException({
    code: 'INVALID_REFRESH_TOKEN',
    message: 'Refresh token is invalid or revoked',
  });
}

function isDuplicateKeyError(err: unknown): boolean {
  const code = (err as { code?: number | string })?.code;
  return code === 11000 || code === '11000' || code === 'E11000';
}
