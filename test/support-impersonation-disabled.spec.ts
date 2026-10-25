import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest');
import { PlatformAdminService } from '../src/modules/admin/application/platform-admin.service';
import { PlatformAdminController } from '../src/modules/admin/presentation/platform-admin.controller';
import { LockUserService } from '../src/modules/admin/application/lock-user.service';
import { RequireCurrentSessionService } from '../src/modules/auth/application/require-current-session.service';
import { SessionRepository } from '../src/modules/auth/domain/session.repository';
import { UserRepository } from '../src/modules/users/domain/user.repository';
import { ApiExceptionFilter } from '../src/shared/errors/api-exception.filter';

const userId = '111111111111111111111111';
const sessionId = '222222222222222222222222';
const organizationId = '333333333333333333333333';
const secret = 'isolated-impersonation-test-key';

function fixture() {
  const model = { findById: jest.fn(), findOne: jest.fn(), create: jest.fn() };
  const audit = { append: jest.fn() };
  const service = new PlatformAdminService(
    model as never,
    model as never,
    model as never,
    model as never,
    model as never,
    model as never,
    model as never,
    audit,
  );
  return { model, audit, service };
}

describe('disabled support impersonation application boundary', () => {
  it.each([organizationId, '444444444444444444444444', 'invalid-id', '', undefined])(
    'rejects target %s before lookup, disclosure or a false success audit',
    async (id) => {
      const f = fixture();
      await expect(f.service.impersonateOrganization(userId, id as string)).rejects.toMatchObject({
        status: 503,
        response: {
          code: 'SUPPORT_IMPERSONATION_UNAVAILABLE',
          message: 'Support View is currently unavailable.',
        },
      });
      for (const method of Object.values(f.model)) expect(method).not.toHaveBeenCalled();
      expect(f.audit.append).not.toHaveBeenCalled();
    },
  );

  it('remains closed on repeated concurrent requests, without reading unavailable dependencies', async () => {
    const f = fixture();
    f.model.findById.mockImplementation(() => {
      throw new Error('database unavailable');
    });
    f.audit.append.mockRejectedValue(new Error('audit unavailable'));
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => f.service.impersonateOrganization(userId, organizationId)),
    );
    for (const result of results) {
      expect(result).toMatchObject({ status: 'rejected', reason: { status: 503 } });
    }
    for (const method of Object.values(f.model)) expect(method).not.toHaveBeenCalled();
    expect(f.audit.append).not.toHaveBeenCalled();
  });
});

// Real controller, JWT guard, current-session use case and error filter; only
// persistence ports are fixtures. This does not certify a support-session lifecycle.
describe('disabled support impersonation HTTP boundary', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let f: ReturnType<typeof fixture>;
  let account: { id: string; isActive: boolean; mustChangePassword: boolean };
  let session: {
    id: string;
    userId: string;
    expiresAt: Date;
    revokedAt?: Date;
    accessVersion: string;
  };
  const users = { findById: jest.fn() };
  const sessions = { findActiveByUserId: jest.fn() };

  beforeAll(async () => {
    f = fixture();
    jwt = new JwtService({ secret });
    const currentSession = new RequireCurrentSessionService(
      sessions as unknown as SessionRepository,
      users as unknown as UserRepository,
    );
    const moduleRef = await Test.createTestingModule({
      controllers: [PlatformAdminController],
      providers: [
        { provide: PlatformAdminService, useValue: f.service },
        { provide: LockUserService, useValue: {} },
        { provide: JwtService, useValue: jwt },
        { provide: ConfigService, useValue: { getOrThrow: () => secret } },
        { provide: RequireCurrentSessionService, useValue: currentSession },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    account = { id: userId, isActive: true, mustChangePassword: false };
    session = {
      id: sessionId,
      userId,
      expiresAt: new Date(Date.now() + 60000),
      accessVersion: 'current',
    };
    users.findById.mockReset().mockImplementation(async () => account);
    sessions.findActiveByUserId.mockReset().mockImplementation(async () => [session]);
  });

  afterEach(() => {
    for (const method of Object.values(f.model)) expect(method).not.toHaveBeenCalled();
    expect(f.audit.append).not.toHaveBeenCalled();
  });
  afterAll(async () => {
    await app?.close();
  });

  const endpoint = `/api/v1/admin/organizations/${organizationId}/impersonate`;
  const token = (claims: Record<string, unknown> = {}) =>
    jwt.sign({
      sub: userId,
      email: 'support@example.test',
      sid: sessionId,
      sv: 'current',
      isPlatformAdmin: false,
      ...claims,
    });

  it('rejects unauthenticated callers', async () => {
    await request(app.getHttpServer()).post(endpoint).expect(401);
    expect(users.findById).not.toHaveBeenCalled();
  });

  it('rejects an invalid signature', async () => {
    await request(app.getHttpServer())
      .post(endpoint)
      .auth('invalid', { type: 'bearer' })
      .expect(401);
    expect(users.findById).not.toHaveBeenCalled();
  });

  it.each([
    { role: 'CUSTOMER' },
    { role: 'internal_support', effectivePermissions: ['organizations.impersonate'] },
    { isPlatformAdmin: true },
    { approvalId: 'claimed-approval', mfaVerified: true, supportSessionId: 'claimed-session' },
  ])('never admits a caller based on claims %j', async (claims) => {
    const response = await request(app.getHttpServer())
      .post(endpoint)
      .auth(token(claims), { type: 'bearer' })
      .send({ readOnly: true, role: 'internal_support', organizationId })
      .expect(503);
    expect(response.body).toEqual({
      statusCode: 503,
      code: 'SUPPORT_IMPERSONATION_UNAVAILABLE',
      message: 'Support View is currently unavailable.',
      details: [],
    });
    expect(users.findById).toHaveBeenCalledWith(userId);
    expect(sessions.findActiveByUserId).toHaveBeenCalledWith(userId);
  });

  it.each(['expired', 'revoked', 'inactive', 'stale', 'sessionless'])(
    'rejects %s ordinary authentication before admission',
    async (state) => {
      if (state === 'expired') session.expiresAt = new Date(0);
      if (state === 'revoked') session.revokedAt = new Date();
      if (state === 'inactive') account.isActive = false;
      if (state === 'stale') session.accessVersion = 'rotated';
      const auth = token(state === 'sessionless' ? { sid: undefined } : {});
      const response = await request(app.getHttpServer())
        .post(endpoint)
        .auth(auth, { type: 'bearer' })
        .expect(401);
      expect(response.body.code).toBe('CURRENT_SESSION_REQUIRED');
    },
  );

  it('fails closed when authoritative ordinary-session storage is unavailable', async () => {
    sessions.findActiveByUserId.mockRejectedValue(new Error('database details must stay private'));
    const response = await request(app.getHttpServer())
      .post(endpoint)
      .auth(token(), { type: 'bearer' })
      .expect(503);
    expect(response.body.code).toBe('SESSION_ASSURANCE_UNAVAILABLE');
    expect(JSON.stringify(response.body)).not.toContain('database details');
  });
});
