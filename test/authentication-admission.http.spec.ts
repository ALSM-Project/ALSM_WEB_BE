import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest');
import { AuthService } from '../src/modules/auth/application/auth.service';
import { EmailVerificationService } from '../src/modules/auth/application/email-verification.service';
import { RequireCurrentSessionService } from '../src/modules/auth/application/require-current-session.service';
import { AuthController } from '../src/modules/auth/presentation/auth.controller';
import { StartMfaSetupService } from '../src/modules/auth/application/start-mfa-setup.service';
import { ConfirmMfaSetupService } from '../src/modules/auth/application/confirm-mfa-setup.service';
import { ForgotPasswordService } from '../src/modules/auth/application/forgot-password.service';
import { ResetPasswordService } from '../src/modules/auth/application/reset-password.service';
import { ChangePasswordService } from '../src/modules/auth/application/change-password.service';
import { SetPasswordService } from '../src/modules/auth/application/set-password.service';
import { ListActiveSessionsService } from '../src/modules/auth/application/list-active-sessions.service';
import { RevokeSessionService } from '../src/modules/auth/application/revoke-session.service';
import { JwtAuthGuard } from '../src/shared/security/jwt-auth.guard';
import { ApiExceptionFilter } from '../src/shared/errors/api-exception.filter';
import { USER_REPOSITORY } from '../src/modules/users/domain/user.repository';
import { SESSION_REPOSITORY } from '../src/modules/auth/domain/session.repository';
import { EMAIL_VERIFICATION_REPOSITORY } from '../src/modules/auth/domain/email-verification.repository';
import { EMAIL_PORT } from '../src/modules/auth/domain/email.port';
import { AUDIT_REPOSITORY } from '../src/modules/audit/domain/audit.repository';
import { ORGANIZATION_REPOSITORY } from '../src/modules/organizations/domain/organization.repository';
import { EffectivePermissionsService } from '../src/modules/rbac/application/effective-permissions.service';
import { admissionFixture, otherId, sessionId, userId } from './authentication-admission.fixture';

describe('real public verification controller, verifier, auth service, JWT and current-session guard', () => {
  let app: INestApplication;
  let f: Awaited<ReturnType<typeof admissionFixture>>;
  beforeEach(async () => {
    f = await admissionFixture();
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        AuthService,
        EmailVerificationService,
        { provide: USER_REPOSITORY, useValue: f.users },
        { provide: SESSION_REPOSITORY, useValue: f.sessions },
        { provide: EMAIL_VERIFICATION_REPOSITORY, useValue: f.proofs },
        { provide: EMAIL_PORT, useValue: f.email },
        { provide: AUDIT_REPOSITORY, useValue: f.audit },
        { provide: ORGANIZATION_REPOSITORY, useValue: {} },
        {
          provide: EffectivePermissionsService,
          useValue: { getUserRoles: async () => [], getEffectivePermissions: async () => [] },
        },
        { provide: RequireCurrentSessionService, useValue: f.current },
        { provide: JwtService, useValue: f.jwt },
        { provide: ConfigService, useValue: f.config },
        JwtAuthGuard,
        ...[
          StartMfaSetupService,
          ConfirmMfaSetupService,
          ForgotPasswordService,
          ResetPasswordService,
          ChangePasswordService,
          SetPasswordService,
          ListActiveSessionsService,
          RevokeSessionService,
        ].map((provide) => ({ provide, useValue: { execute: jest.fn() } })),
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
  });
  afterEach(async () => {
    await app.close();
  });
  it('returns the existing token shape only for legitimate proof; a replay returns a generic non-token error', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({ email: f.account.email, code: f.code, isPlatformAdmin: true })
      .expect(200);
    expect(Object.keys(response.body).sort()).toEqual([
      'accessToken',
      'hasPassword',
      'mustChangePassword',
      'refreshToken',
    ]);
    const claims = await f.jwt.verifyAsync(response.body.accessToken, {
      secret: f.config.getOrThrow('JWT_ACCESS_SECRET'),
    });
    expect(claims.isPlatformAdmin).toBe(false);
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${response.body.accessToken}`)
      .expect(200);
    const replay = await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({ email: f.account.email, code: f.code })
      .expect(400);
    expect(replay.body.code).toBe('INVALID_VERIFICATION_CODE');
    expect(replay.body.accessToken).toBeUndefined();
    expect(f.rows).toHaveLength(1);
  });
  it.each([{}, { code: '' }, { code: 'malformed' }, { code: [] }])(
    'rejects malformed public bodies before creating sessions',
    async (input) => {
      f.account.isEmailVerified = true;
      await request(app.getHttpServer())
        .post('/auth/verify-email')
        .send({ email: f.account.email, ...input })
        .expect(400);
      expect(f.rows).toHaveLength(0);
      expect(f.audit.append).not.toHaveBeenCalled();
    },
  );
  it('denies a previously issued signed token and refresh after lock, even when session revocation did not occur', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({ email: f.account.email, code: f.token })
      .expect(200);
    f.account.isLocked = true;
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${response.body.accessToken}`)
      .expect(401);
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: response.body.refreshToken })
      .expect(401);
    expect(f.sessions.rotateRefresh).not.toHaveBeenCalled();
  });
  it.each([
    'missing-generation',
    'stale-generation',
    'malformed-subject',
    'forged-admin',
    'other-identity',
  ])('does not accept %s claims as current-session authority', async (kind) => {
    await f.service.verifyEmail(f.account.email, f.code);
    const claims: Record<string, unknown> = {
      sub: userId,
      sid: sessionId,
      sv: f.rows[0].accessVersion,
      isPlatformAdmin: true,
    };
    if (kind === 'missing-generation') delete claims.sv;
    if (kind === 'stale-generation') claims.sv = 'stale';
    if (kind === 'malformed-subject') claims.sub = {};
    if (kind === 'other-identity') claims.sub = otherId;
    let signed = await f.jwt.signAsync(claims, {
      secret: f.config.getOrThrow('JWT_ACCESS_SECRET'),
    });
    if (kind === 'forged-admin') signed += 'tampered';
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${signed}`)
      .expect(401);
  });
  it('keeps repository outages as a sanitized 503 without logging private driver details', async () => {
    f.proofs.consumeActive.mockRejectedValue(new Error('private driver detail'));
    const logger = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await request(app.getHttpServer())
        .post('/auth/verify-email')
        .send({ email: f.account.email, code: f.code })
        .expect(503);
      expect(response.body.code).toBe('EMAIL_VERIFICATION_UNAVAILABLE');
      expect(JSON.stringify(response.body)).not.toContain('private');
      expect(logger).not.toHaveBeenCalled();
    } finally {
      logger.mockRestore();
    }
  });
});
