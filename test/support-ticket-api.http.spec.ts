import { INestApplication, ServiceUnavailableException, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest');
import { RequireCurrentSessionService } from '../src/modules/auth/application/require-current-session.service';
import { SESSION_REPOSITORY } from '../src/modules/auth/domain/session.repository';
import { USER_REPOSITORY } from '../src/modules/users/domain/user.repository';
import { OrganizationContextService } from '../src/modules/organizations/application/organization-context.service';
import { OrganizationAuthorizationService } from '../src/modules/organizations/application/organization-authorization.service';
import { OwnerSupportTicketAccessService } from '../src/modules/organizations/application/owner-support-ticket-access.service';
import {
  ORGANIZATION_REPOSITORY,
  OrganizationRecord,
} from '../src/modules/organizations/domain/organization.repository';
import {
  OrganizationRole,
  OrganizationType,
} from '../src/modules/organizations/domain/organization.types';
import { INTERNAL_SUPPORT_ASSIGNMENT } from '../src/modules/rbac/domain/internal-support-assignment.port';
import { CreateSupportTicketService } from '../src/modules/support/application/create-support-ticket.service';
import { GetSupportTicketService } from '../src/modules/support/application/get-support-ticket.service';
import { ListSupportTicketsService } from '../src/modules/support/application/list-support-tickets.service';
import { TransitionSupportTicketService } from '../src/modules/support/application/transition-support-ticket.service';
import { SUPPORT_TICKET_ACCESS } from '../src/modules/support/application/support-ticket-access.port';
import { SUPPORT_TICKET_REPOSITORY } from '../src/modules/support/domain/support-ticket.repository';
import { SUPPORT_TICKET_LISTING } from '../src/modules/support/domain/support-ticket-listing.port';
import { SupportTicketEntity } from '../src/modules/support/domain/support-ticket.entity';
import { SupportTicketProps } from '../src/modules/support/domain/support-ticket.types';
import { SupportTicketController } from '../src/modules/support/presentation/support-ticket.controller';
import { SupportTicketOwnerGuard } from '../src/modules/support/presentation/support-ticket-owner.guard';
import { ApiExceptionFilter } from '../src/shared/errors/api-exception.filter';

const actor = '111111111111111111111111';
const org = '222222222222222222222222';
const foreign = '333333333333333333333333';
const sid = '444444444444444444444444';
const ticketId = '00000000-0000-4000-8000-000000000001';
const base = `/api/v1/organizations/${org}/support-tickets`;
const secret = 'isolated-owner-ticket-http-fixture-key';

// Real controllers, guards, account/session assurance, Owner adapter and use cases.
// Only persistence ports are fixtures; Mongo atomic audit is verified separately.
describe('Owner-only Support Ticket HTTP API', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let records: Map<string, SupportTicketProps>;
  let organization: OrganizationRecord;
  let active: boolean;
  let locked: boolean;
  let revoked: boolean;
  const organizations = { findForMember: jest.fn() };
  const supportAssignments = { hasCurrentAssignment: jest.fn() };
  const tickets = {
    create: jest.fn(async (ticket: SupportTicketEntity) => {
      records.set(ticket.toProps().ticketId, ticket.toProps());
    }),
    findById: jest.fn(async (id: string, organizationId: string) => {
      const props = records.get(id);
      return props?.organizationId === organizationId
        ? SupportTicketEntity.fromPersistence(props)
        : null;
    }),
    save: jest.fn(async (ticket: SupportTicketEntity, revision: number) => {
      const next = ticket.toProps();
      if (records.get(next.ticketId)?.revision !== revision) return false;
      records.set(next.ticketId, next);
      return true;
    }),
    list: jest.fn(async (organizationId: string, limit: number, after?: string) =>
      [...records.values()]
        .filter((p) => p.organizationId === organizationId && (!after || p.ticketId > after))
        .sort((a, b) => a.ticketId.localeCompare(b.ticketId))
        .slice(0, limit + 1)
        .map((props) => SupportTicketEntity.fromPersistence(props)),
    ),
  };
  const users = {
    findById: jest.fn(async () => ({
      id: actor,
      isActive: active,
      isLocked: locked,
      mustChangePassword: false,
    })),
  };
  const sessions = {
    findActiveByUserId: jest.fn(async () => [
      {
        id: sid,
        userId: actor,
        accessVersion: 'v1',
        expiresAt: new Date(Date.now() + 60000),
        revokedAt: revoked ? new Date() : undefined,
      },
    ]),
  };

  const token = (claims = {}) =>
    jwt.sign(
      {
        sub: actor,
        sid,
        sv: 'v1',
        email: 'owner@example.invalid',
        isPlatformAdmin: false,
        ...claims,
      },
      { secret },
    );
  const call = (method: 'get' | 'post', path: string, body?: object, bearer = token()) => {
    const operation = request(app.getHttpServer())
      [method](path)
      .set('Authorization', `Bearer ${bearer}`);
    return body ? operation.send(body) : operation;
  };
  function seed(id = ticketId, organizationId = org) {
    const ticket = SupportTicketEntity.createNew({
      ticketId: id,
      organizationId,
      requesterUserId: actor,
      purposeId: 'diagnose',
      episodeId: '00000000-0000-4000-8000-000000000099',
      now: new Date('2026-10-28T00:00:00Z'),
    });
    records.set(id, ticket.toProps());
    return ticket;
  }

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [SupportTicketController],
      providers: [
        JwtService,
        RequireCurrentSessionService,
        OrganizationContextService,
        OrganizationAuthorizationService,
        OwnerSupportTicketAccessService,
        SupportTicketOwnerGuard,
        CreateSupportTicketService,
        GetSupportTicketService,
        ListSupportTicketsService,
        TransitionSupportTicketService,
        { provide: ConfigService, useValue: new ConfigService({ JWT_ACCESS_SECRET: secret }) },
        { provide: USER_REPOSITORY, useValue: users },
        { provide: SESSION_REPOSITORY, useValue: sessions },
        { provide: ORGANIZATION_REPOSITORY, useValue: organizations },
        { provide: INTERNAL_SUPPORT_ASSIGNMENT, useValue: supportAssignments },
        { provide: SUPPORT_TICKET_REPOSITORY, useValue: tickets },
        { provide: SUPPORT_TICKET_LISTING, useValue: tickets },
        { provide: SUPPORT_TICKET_ACCESS, useExisting: OwnerSupportTicketAccessService },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
    jwt = module.get(JwtService);
  });
  afterAll(async () => app.close());
  beforeEach(() => {
    jest.clearAllMocks();
    active = true;
    locked = false;
    revoked = false;
    records = new Map();
    organization = {
      id: org,
      name: 'Owned',
      type: OrganizationType.ENTERPRISE,
      members: [{ userId: actor, role: OrganizationRole.OWNER }],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    organizations.findForMember.mockImplementation(async (id: string, userId: string) =>
      id === org && organization.members.some((m) => m.userId === userId)
        ? structuredClone(organization)
        : null,
    );
    supportAssignments.hasCurrentAssignment.mockReset().mockResolvedValue(false);
  });

  const routes = [
    ['post', '', { purposeId: 'diagnose' }],
    ['get', `/${ticketId}`, undefined],
    ['get', '', undefined],
    ['post', `/${ticketId}/close`, { expectedRevision: 0 }],
    ['post', `/${ticketId}/cancel`, { expectedRevision: 0 }],
    ['post', `/${ticketId}/reopen`, { expectedRevision: 1 }],
  ] as const;
  it.each(routes)('requires authentication for %s %s', async (method, suffix, body) => {
    expect(
      (
        await request(app.getHttpServer())
          [method](base + suffix)
          .send(body)
      ).status,
    ).toBe(401);
    expect((await call(method, base + suffix, body, 'invalid')).status).toBe(401);
    expect(tickets.create).not.toHaveBeenCalled();
    expect(tickets.findById).not.toHaveBeenCalled();
    expect(tickets.list).not.toHaveBeenCalled();
    expect(tickets.save).not.toHaveBeenCalled();
  });
  it.each(routes)(
    'denies a customer member and forged Admin JWT claims for %s %s',
    async (method, suffix, body) => {
      organization.members[0].role = OrganizationRole.MEMBER;
      expect(
        (
          await call(
            method,
            base + suffix,
            body,
            token({ isPlatformAdmin: true, role: 'OWNER', organizationId: org, personId: actor }),
          )
        ).status,
      ).toBe(403);
      expect(tickets.create).not.toHaveBeenCalled();
      expect(tickets.findById).not.toHaveBeenCalled();
      expect(tickets.list).not.toHaveBeenCalled();
      expect(tickets.save).not.toHaveBeenCalled();
    },
  );
  it.each(routes)(
    'denies foreign Organisation scope for %s %s before any Ticket read',
    async (method, suffix, body) => {
      expect((await call(method, base.replace(org, foreign) + suffix, body)).status).toBe(403);
      expect(tickets.findById).not.toHaveBeenCalled();
      expect(tickets.list).not.toHaveBeenCalled();
      expect(tickets.create).not.toHaveBeenCalled();
      expect(tickets.save).not.toHaveBeenCalled();
    },
  );
  it.each([OrganizationRole.ADMIN, OrganizationRole.VIEWER])(
    'denies Organisation %s',
    async (role) => {
      organization.members[0].role = role;
      expect((await call('get', base)).status).toBe(403);
    },
  );
  it('denies persisted Support staff even with an Owner membership', async () => {
    supportAssignments.hasCurrentAssignment.mockResolvedValue(true);
    expect(await call('post', base, { purposeId: 'diagnose' })).toMatchObject({ status: 403 });
    expect(tickets.create).not.toHaveBeenCalled();
  });
  it.each(['revoked', 'inactive', 'locked', 'sessionless', 'expired'] as const)(
    'denies %s authentication',
    async (condition) => {
      revoked = condition === 'revoked';
      active = condition !== 'inactive';
      locked = condition === 'locked';
      const claims =
        condition === 'sessionless'
          ? { sid: undefined, sv: undefined }
          : condition === 'expired'
            ? { exp: 1 }
            : {};
      expect((await call('get', base, undefined, token(claims))).status).toBe(401);
      expect(tickets.list).not.toHaveBeenCalled();
    },
  );
  it('denies removed, ambiguous and unverifiable Owner authority', async () => {
    organization.members = [];
    expect((await call('get', base)).status).toBe(403);
    organization.members = [
      { userId: actor, role: OrganizationRole.OWNER },
      { userId: actor, role: OrganizationRole.MEMBER },
    ];
    expect((await call('get', base)).status).toBe(403);
    organizations.findForMember.mockRejectedValueOnce(new Error('unavailable'));
    expect((await call('get', base)).body.code).toBe('SUPPORT_TICKET_AUTHORITY_UNAVAILABLE');
    expect(tickets.list).not.toHaveBeenCalled();
  });
  it('fails closed when the staff denial authority is unavailable', async () => {
    supportAssignments.hasCurrentAssignment.mockRejectedValue(new Error('unavailable'));
    expect((await call('get', base)).status).toBe(503);
    expect(tickets.list).not.toHaveBeenCalled();
  });
  it('creates server identities, derives requester, returns safe metadata and grants no decisions', async () => {
    const response = await call('post', base, { purposeId: 'diagnose' });
    expect(response.status).toBe(201);
    expect(Object.keys(response.body).sort()).toEqual(
      [
        'ticketId',
        'organizationId',
        'episodeId',
        'purposeId',
        'status',
        'revision',
        'createdAt',
        'updatedAt',
      ].sort(),
    );
    expect(response.body).toMatchObject({ organizationId: org, status: 'OPEN', revision: 0 });
    expect(records.get(response.body.ticketId)).toMatchObject({
      requesterUserId: actor,
      decisionReferences: null,
    });
    expect(records.get(response.body.ticketId)?.episodes[0].openedBy).toBe(actor);
  });
  it.each([
    'actorId',
    'actorUserId',
    'personId',
    'role',
    'organizationId',
    'requesterUserId',
    'isPlatformAdmin',
    'decisionReferences',
    'customerConsent',
    'internalApproval',
  ])('rejects forged body field %s', async (field) => {
    expect((await call('post', base, { purposeId: 'diagnose', [field]: actor })).status).toBe(400);
    expect(tickets.create).not.toHaveBeenCalled();
  });
  it.each([
    {},
    { purposeId: '' },
    { purposeId: 'has whitespace' },
    { purposeId: 'x'.repeat(201) },
    { purposeId: 1 },
  ])('rejects invalid creation DTO %j', async (body) => {
    expect((await call('post', base, body)).status).toBe(400);
  });
  it('retrieves only within the verified Organisation and masks foreign existence', async () => {
    seed();
    expect((await call('get', `${base}/${ticketId}`)).status).toBe(200);
    seed(ticketId, foreign);
    const foreignResult = await call('get', `${base}/${ticketId}`);
    records.clear();
    const missingResult = await call('get', `${base}/${ticketId}`);
    expect(foreignResult.status).toBe(404);
    expect(foreignResult.body).toEqual(missingResult.body);
  });
  it('paginates with a bound and no foreign entries or global route', async () => {
    seed();
    seed('00000000-0000-4000-8000-000000000002');
    seed('00000000-0000-4000-8000-000000000003', foreign);
    const first = await call('get', `${base}?limit=1`);
    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(1);
    expect(first.body.nextAfterTicketId).toBe(ticketId);
    const second = await call(
      'get',
      `${base}?limit=1&afterTicketId=${first.body.nextAfterTicketId}`,
    );
    expect(second.body.items).toHaveLength(1);
    expect(second.body.nextAfterTicketId).toBeNull();
    expect(tickets.list).toHaveBeenCalledWith(org, 1, ticketId);
    expect((await call('get', '/api/v1/support-tickets')).status).toBe(404);
  });
  it.each([
    'limit=0',
    'limit=51',
    'limit=1.5',
    'limit=-1',
    'limit=1e1',
    'limit=abc',
    'limit=1&limit=2',
    'afterTicketId=bad',
    'organizationId=' + foreign,
    'role=OWNER',
  ])('rejects invalid list query %s', async (query) => {
    expect((await call('get', `${base}?${query}`)).status).toBe(400);
    expect(tickets.list).not.toHaveBeenCalled();
  });
  it.each(['close', 'cancel'])(
    'runs %s and reopens with fresh episode, preserving history',
    async (action) => {
      seed();
      const ended = await call('post', `${base}/${ticketId}/${action}`, { expectedRevision: 0 });
      expect(ended.status).toBe(200);
      expect(ended.body.revision).toBe(1);
      const reopened = await call('post', `${base}/${ticketId}/reopen`, { expectedRevision: 1 });
      expect(reopened.status).toBe(200);
      expect(reopened.body.episodeId).not.toBe(ended.body.episodeId);
      expect(records.get(ticketId)?.episodes).toHaveLength(2);
      expect(records.get(ticketId)?.decisionReferences).toBeNull();
    },
  );
  it.each([
    {},
    { expectedRevision: '0' },
    { expectedRevision: -1 },
    { expectedRevision: 0.5 },
    { expectedRevision: Number.MAX_SAFE_INTEGER + 1 },
    { expectedRevision: 0, actorId: actor },
  ])('rejects invalid transition DTO %j', async (body) => {
    seed();
    expect((await call('post', `${base}/${ticketId}/close`, body)).status).toBe(400);
    expect(tickets.save).not.toHaveBeenCalled();
  });
  it('returns revision and lifecycle conflicts without writes or retries', async () => {
    seed();
    expect(
      (await call('post', `${base}/${ticketId}/close`, { expectedRevision: 1 })).body.code,
    ).toBe('SUPPORT_TICKET_CONFLICT');
    expect(
      (await call('post', `${base}/${ticketId}/reopen`, { expectedRevision: 0 })).body.code,
    ).toBe('SUPPORT_TICKET_INVALID_TRANSITION');
    expect(tickets.save).not.toHaveBeenCalled();
    tickets.save.mockResolvedValueOnce(false);
    expect((await call('post', `${base}/${ticketId}/close`, { expectedRevision: 0 })).status).toBe(
      409,
    );
    expect(tickets.save).toHaveBeenCalledTimes(1);
  });
  it('preserves unconfirmed outcome reconciliation and performs no automatic retry', async () => {
    seed();
    const details = [
      {
        resourceId: ticketId,
        organizationId: org,
        episodeId: records.get(ticketId)!.episodeId,
        revision: 1,
        expectedRevision: 0,
        mutationCommitted: 'unknown',
        retrySafe: false,
      },
    ];
    tickets.save.mockRejectedValueOnce(
      new ServiceUnavailableException({
        code: 'SUPPORT_TICKET_OUTCOME_UNCONFIRMED',
        message: 'Reconcile the original Ticket before retrying',
        details,
      }),
    );
    const response = await call('post', `${base}/${ticketId}/close`, { expectedRevision: 0 });
    expect(response.status).toBe(503);
    expect(response.body.details).toEqual(details);
    expect(tickets.save).toHaveBeenCalledTimes(1);
  });
});
