import { ServiceUnavailableException } from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest');
import { OrganizationRole } from '../src/modules/organizations/domain/organization.types';
import { CustomerConsentContextService } from '../src/modules/support/application/customer-consent-context.service';
import { RequestCustomerConsentService } from '../src/modules/support/application/request-customer-consent.service';
import { CustomerConsentController } from '../src/modules/support/presentation/customer-consent.controller';
import {
  consentActorFixture,
  consentIds,
  pendingConsentFixture,
} from './customer-consent.fixtures';
import {
  createConsentHttpFixture,
  consentHttpBase as base,
  consentHttpRequestBody,
  consentHttpDeclineBody,
  consentHttpStatusQuery,
} from './customer-consent-api.fixtures';

const reservedKeys = ['__proto__', 'prototype', 'constructor'] as const;
/** JSON.parse ensures __proto__ is an actual own property, not object-literal syntax. */
function reservedOwnProperties(body: object, key: (typeof reservedKeys)[number]): object {
  const forged = {
    uc66P3Polluted: true,
    actorUserId: consentIds.beneficiary,
    personId: 'forged-person',
    accountId: consentIds.beneficiary,
    organizationId: consentIds.foreignOrganization,
    ticketId: consentIds.nextEpisode,
    episodeId: consentIds.nextEpisode,
    purposeId: 'forged-purpose',
    action: 'GRANT',
    state: 'VERIFIED_GRANTED',
    status: 'CURRENT',
    verified: true,
    role: 'OWNER',
    prototype: { uc66P3Polluted: true },
  };
  const parsed: object = JSON.parse(JSON.stringify(body));
  let containers = 0;
  function inject(value: object) {
    for (const child of Object.values(value)) if (child && typeof child === 'object') inject(child);
    Object.defineProperty(value, key, { value: forged, enumerable: true });
    containers++;
  }
  inject(parsed);
  const payload: object = JSON.parse(JSON.stringify(parsed));
  let ownKeys = 0;
  function check(value: object) {
    expect(Object.hasOwn(value, key)).toBe(true);
    ownKeys++;
    for (const [name, child] of Object.entries(value))
      if (name !== key && child && typeof child === 'object') check(child);
  }
  check(payload);
  expect(ownKeys).toBe(containers);
  expect(containers).toBeGreaterThan(1);
  return payload;
}
function expectNoReservedPollution() {
  expect(Object.hasOwn(Object.prototype, 'uc66P3Polluted')).toBe(false);
  expect(Object.hasOwn(Object.prototype, 'actorUserId')).toBe(false);
  expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  expect({}.constructor).toBe(Object);
}

/** Actual HTTP/guards/use cases; synthetic persistence and authority, never production AppModule. */
describe('Isolated Customer Consent HTTP contracts (unregistered)', () => {
  let h: Awaited<ReturnType<typeof createConsentHttpFixture>>;
  const fixed = consentIds.consent;
  const call = (method: 'get' | 'post', suffix = '', body?: object, bearer?: string) => {
    let op = request(h.app.getHttpServer())
      [method](base + suffix)
      .set('Authorization', `Bearer ${bearer ?? h.token()}`);
    if (method === 'get') op = op.query(consentHttpStatusQuery());
    return body ? op.send(body) : op;
  };
  const routes = [
    ['post', '', consentHttpRequestBody],
    ['get', `/${fixed}`, () => undefined],
    ['post', `/${fixed}/decline`, consentHttpDeclineBody],
  ] as const;
  beforeEach(async () => {
    h = await createConsentHttpFixture();
    h.approve('REQUEST', 'request-1');
  });
  afterEach(async () => h.app.close());
  async function created() {
    const result = await call('post', '', consentHttpRequestBody());
    expect(result.status).toBe(201);
    h.approve('STATUS', `status:${result.body.consentId}`, result.body.consentId);
    h.approve('DECLINE', 'decline-1', result.body.consentId);
    return result.body as { consentId: string; revision: number };
  }
  it.each(routes)(
    'requires a valid authenticated current session for %s %s',
    async (method, suffix, body) => {
      expect(
        (
          await request(h.app.getHttpServer())
            [method](base + suffix)
            .send(body())
        ).status,
      ).toBe(401);
      for (const bearer of [
        'invalid',
        h.token({ sid: undefined }),
        h.token({ sv: 'forged' }),
        h.token({ sub: consentIds.beneficiary }),
        h.token({ exp: 1 }),
      ])
        expect((await call(method, suffix, body(), bearer)).status).toBe(401);
      expect(h.f.authority.authorize).not.toHaveBeenCalled();
      expect(h.f.consents.create).not.toHaveBeenCalled();
    },
  );
  it.each(['active', 'locked', 'revoked', 'expired'] as const)(
    'denies persisted account/session condition %s',
    async (condition) => {
      h.control[condition] = condition !== 'active';
      for (const [method, suffix, body] of routes)
        expect((await call(method, suffix, body())).status).toBe(401);
      expect(h.f.authority.authorize).not.toHaveBeenCalled();
    },
  );
  it.each(routes)(
    'denies members and forged Admin/Owner identity claims for %s %s',
    async (method, suffix, body) => {
      h.f.organization.members[0].role = OrganizationRole.MEMBER;
      expect(
        (
          await call(
            method,
            suffix,
            body(),
            h.token({
              isPlatformAdmin: true,
              role: 'OWNER',
              personId: 'forged',
              organizationId: consentIds.organization,
            }),
          )
        ).status,
      ).toBe(403);
      expect(h.f.tickets.findById).not.toHaveBeenCalled();
    },
  );
  it.each(routes)(
    'denies Support Staff, including simultaneous Owners, for %s %s',
    async (method, suffix, body) => {
      h.f.staff.hasCurrentAssignment.mockResolvedValue(true);
      expect((await call(method, suffix, body())).status).toBe(403);
      expect(h.f.authority.authorize).not.toHaveBeenCalled();
    },
  );
  it.each(['missing', 'duplicate', 'foreign'] as const)(
    'denies %s Organisation membership',
    async (kind) => {
      if (kind === 'missing') h.f.organization.members.length = 0;
      if (kind === 'duplicate') h.f.organization.members.push({ ...h.f.organization.members[0] });
      const path =
        kind === 'foreign'
          ? base.replace(consentIds.organization, consentIds.foreignOrganization)
          : base;
      expect(
        (
          await request(h.app.getHttpServer())
            .post(path)
            .set('Authorization', `Bearer ${h.token()}`)
            .send(consentHttpRequestBody())
        ).status,
      ).toBe(403);
      expect(h.f.consents.create).not.toHaveBeenCalled();
    },
  );
  it('fails closed without the independent authority provider despite a valid Owner', async () => {
    const absent = await createConsentHttpFixture([], true);
    try {
      expect(
        (
          await request(absent.app.getHttpServer())
            .post(base)
            .set('Authorization', `Bearer ${absent.token()}`)
            .send(consentHttpRequestBody())
        ).status,
      ).toBe(403);
      expect(absent.f.consents.create).not.toHaveBeenCalled();
    } finally {
      await absent.app.close();
    }
  });
  it.each(['null', 'stale', 'mismatched', 'unavailable'] as const)(
    'rejects %s independent authority',
    async (kind) => {
      h.f.authority.authorize.mockImplementationOnce(async (r) => {
        if (kind === 'null') return null;
        if (kind === 'unavailable') throw new Error('private authority failure');
        const response = consentActorFixture(r);
        if (kind === 'stale') Object.assign(response.actor.provenance, { status: 'STALE' });
        if (kind === 'mismatched') Object.assign(response.request, { action: 'DECLINE' });
        return response;
      });
      const result = await call('post', '', consentHttpRequestBody());
      expect(result.status).toBe(kind === 'unavailable' ? 503 : 403);
      expect(JSON.stringify(result.body)).not.toContain('private authority failure');
      expect(h.f.consents.create).not.toHaveBeenCalled();
    },
  );
  it.each([
    'actorId',
    'actorUserId',
    'grantor',
    'personId',
    'accountId',
    'role',
    'organizationId',
    'customerAuthority',
    'state',
    'verified',
    'operationalAccess',
    'consentId',
    'revision',
    'verificationAttemptId',
  ])('rejects unknown/forged body authority field %s', async (field) => {
    expect(
      (await call('post', '', { ...consentHttpRequestBody(), [field]: 'forged' })).status,
    ).toBe(400);
    expect(h.f.authority.authorize).not.toHaveBeenCalled();
  });
  it.each(reservedKeys)(
    'strips reserved own %s at every request DTO level without redirecting authority',
    async (key) => {
      const body = consentHttpRequestBody();
      const result = await call('post', '', reservedOwnProperties(body, key));
      expect(result.status).toBe(201);
      expect(result.body).toMatchObject({
        organizationId: consentIds.organization,
        ticketId: consentIds.ticket,
        episodeId: consentIds.episode,
        state: 'PENDING_VERIFICATION',
        operationalAccess: false,
      });
      const [bound] = h.f.authority.authorize.mock.calls[0];
      expect(bound).toMatchObject({
        actorUserId: consentIds.actor,
        action: 'REQUEST',
        ticket: {
          organizationId: consentIds.organization,
          ticketId: consentIds.ticket,
          episodeId: consentIds.episode,
        },
      });
      expect(bound.proposal).toEqual(body.proposal);
      expect(bound.scope).toEqual(body.proposal.scope);
      expect(bound.source).toEqual(body.source);
      const persisted = h.f.records.get(result.body.consentId)!;
      expect(persisted.grantor).toMatchObject({
        personId: 'customer-owner-person',
        accountId: consentIds.actor,
      });
      for (const value of [bound, persisted, h.f.audits])
        expect(JSON.stringify(value)).not.toMatch(/uc66P3Polluted|forged-person|forged-purpose/);
      expectNoReservedPollution();
    },
  );
  it.each(reservedKeys)(
    'cannot change DECLINE or STATUS binding through reserved own %s',
    async (key) => {
      const c = await created();
      h.f.authority.authorize.mockClear();
      const body = consentHttpDeclineBody();
      const result = await call(
        'post',
        `/${c.consentId}/decline`,
        reservedOwnProperties(body, key),
      );
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ state: 'DECLINED', operationalAccess: false });
      expect(h.f.authority.authorize.mock.calls[0][0]).toMatchObject({
        actorUserId: consentIds.actor,
        action: 'DECLINE',
        consentId: c.consentId,
        scope: body.scope,
        source: body.source,
      });
      // GET has no body binding; even unsanitized body claims cannot become authority.
      expect((await call('get', `/${c.consentId}`, reservedOwnProperties(body, key))).status).toBe(
        200,
      );
      expect(h.f.authority.authorize.mock.calls[1][0]).toMatchObject({
        actorUserId: consentIds.actor,
        action: 'STATUS',
        consentId: c.consentId,
        source: null,
        scope: body.scope,
      });
      for (const [bound] of h.f.authority.authorize.mock.calls)
        expect(JSON.stringify(bound)).not.toContain('uc66P3Polluted');
      expectNoReservedPollution();
    },
  );
  it.each(reservedKeys)(
    'reserved own %s cannot replace independent evidence or bypass ordinary unknown-field rejection',
    async (key) => {
      h.intents.clear();
      const body = consentHttpRequestBody();
      expect((await call('post', '', reservedOwnProperties(body, key))).status).toBe(403);
      h.f.authority.authorize.mockClear();
      for (const unknown of [
        { ...body, unrecognized: 'forged' },
        { ...body, source: { ...body.source, unrecognized: 'forged' } },
      ])
        expect((await call('post', '', reservedOwnProperties(unknown, key))).status).toBe(400);
      expect(h.f.authority.authorize).not.toHaveBeenCalled();
      expect(h.f.consents.create).not.toHaveBeenCalled();
      expect(h.f.audits).toEqual([]);
      expectNoReservedPollution();
    },
  );
  it.each(reservedKeys)(
    'reserved own %s cannot bypass authentication or current Owner checks on any route',
    async (key) => {
      for (const [method, suffix, makeBody] of routes) {
        const body = reservedOwnProperties(makeBody() ?? consentHttpRequestBody(), key);
        expect(
          (
            await request(h.app.getHttpServer())
              [method](base + suffix)
              .send(body)
          ).status,
        ).toBe(401);
        h.f.organization.members[0].role = OrganizationRole.MEMBER;
        expect((await call(method, suffix, body)).status).toBe(403);
      }
      expect(h.f.authority.authorize).not.toHaveBeenCalled();
      expect(h.f.consents.create).not.toHaveBeenCalled();
      expect(h.f.consents.save).not.toHaveBeenCalled();
      expectNoReservedPollution();
    },
  );
  it.each(['person', 'account', 'source', 'policy', 'beneficiary-status'] as const)(
    'cannot authenticate forged proposed %s',
    async (kind) => {
      const body = consentHttpRequestBody();
      if (kind === 'person') {
        body.proposal.beneficiary.identity.personId = 'forged';
        body.proposal.coverage.personId = 'forged';
      }
      if (kind === 'account') {
        body.proposal.beneficiary.identity.accountId = consentIds.actor;
        body.proposal.coverage.accountId = consentIds.actor;
      }
      if (kind === 'source') body.source.authorityId = 'untrusted-channel';
      if (kind === 'policy') body.proposal.policy.sha256 = 'b'.repeat(64);
      if (kind === 'beneficiary-status') body.proposal.beneficiary.entitlement.status = 'CURRENT';
      expect((await call('post', '', body)).status).toBe(403);
      expect(h.f.consents.create).not.toHaveBeenCalled();
    },
  );
  it.each([
    (b: ReturnType<typeof consentHttpRequestBody>) =>
      Object.assign(b, { expectedTicketRevision: '0' }),
    (b: ReturnType<typeof consentHttpRequestBody>) =>
      Object.assign(b, { expectedTicketRevision: -1 }),
    (b: ReturnType<typeof consentHttpRequestBody>) =>
      Object.assign(b, { expectedTicketRevision: Number.MAX_SAFE_INTEGER + 1 }),
    (b: ReturnType<typeof consentHttpRequestBody>) => Object.assign(b, { episodeId: 'not-uuid' }),
    (b: ReturnType<typeof consentHttpRequestBody>) => Object.assign(b, { proposal: [] }),
    (b: ReturnType<typeof consentHttpRequestBody>) =>
      Object.assign(b.proposal.scope, { purposeId: 'bad\nvalue' }),
    (b: ReturnType<typeof consentHttpRequestBody>) =>
      Object.assign(b.proposal.policy, { rawEvidence: 'secret' }),
    (b: ReturnType<typeof consentHttpRequestBody>) =>
      Object.assign(b.proposal.beneficiary.identity.provenance, { credential: 'secret' }),
    (b: ReturnType<typeof consentHttpRequestBody>) => Object.assign(b, { source: null }),
  ])('rejects malformed nested DTOs without persisting', async (mutate) => {
    const body = consentHttpRequestBody();
    mutate(body);
    expect((await call('post', '', body)).status).toBe(400);
    expect(h.f.consents.create).not.toHaveBeenCalled();
  });
  it('requests, reads and declines with exact safe response fields and bound commands', async () => {
    const c = await created();
    const response = await call('get', `/${c.consentId}`);
    expect(response.status).toBe(200);
    expect(Object.keys(response.body).sort()).toEqual(
      [
        'consentId',
        'organizationId',
        'ticketId',
        'episodeId',
        'state',
        'revision',
        'operationalAccess',
        'ticketCompatibility',
      ].sort(),
    );
    expect(response.body).toMatchObject({
      state: 'PENDING_VERIFICATION',
      operationalAccess: false,
      ticketCompatibility: 'CURRENT_EPISODE_OPEN',
    });
    const declined = await call('post', `/${c.consentId}/decline`, consentHttpDeclineBody());
    expect(declined.status).toBe(200);
    expect(Object.keys(declined.body).sort()).toEqual(
      Object.keys(response.body)
        .filter((k) => k !== 'ticketCompatibility')
        .sort(),
    );
    expect(declined.body).toMatchObject({
      state: 'DECLINED',
      revision: 1,
      operationalAccess: false,
    });
    expect(h.f.audits).toHaveLength(2);
    expect(h.f.authority.authorize.mock.calls.map(([r]) => r.action)).toEqual([
      'REQUEST',
      'STATUS',
      'DECLINE',
    ]);
  });
  it('requires the independently verified original person/account for decline', async () => {
    const c = await created();
    h.f.authority.authorize.mockImplementationOnce(async (r) => {
      const a = consentActorFixture(r);
      Object.assign(a.actor, { personId: 'successor-owner-person' });
      return a;
    });
    expect((await call('post', `/${c.consentId}/decline`, consentHttpDeclineBody())).status).toBe(
      403,
    );
    expect(h.f.consents.save).not.toHaveBeenCalled();
  });
  it('returns indistinguishable scoped 404s for missing and foreign Consent', async () => {
    const p = pendingConsentFixture().toProps();
    Object.assign(p, { organizationId: consentIds.foreignOrganization });
    Object.assign(p.customerAuthority, { organizationId: consentIds.foreignOrganization });
    h.f.records.set(fixed, p);
    for (const id of [fixed, consentIds.nextEpisode]) {
      h.approve('STATUS', `status:${id}`, id);
      const r = await call('get', `/${id}`);
      expect(r.status).toBe(404);
      expect(r.body.code).toBe('CUSTOMER_CONSENT_NOT_FOUND');
      expect(JSON.stringify(r.body)).not.toContain(consentIds.foreignOrganization);
    }
  });
  it('does not disclose a foreign Ticket', async () => {
    h.f.tickets.findById.mockResolvedValue(null);
    const r = await call('post', '', consentHttpRequestBody());
    expect(r.status).toBe(404);
    expect(r.body.code).toBe('SUPPORT_TICKET_NOT_FOUND');
  });
  it('rejects stale Ticket and Consent revisions, and repeated terminal decline', async () => {
    const c = await created();
    expect(
      (
        await call('post', `/${c.consentId}/decline`, {
          ...consentHttpDeclineBody(),
          expectedTicketRevision: 1,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call('post', `/${c.consentId}/decline`, {
          ...consentHttpDeclineBody(),
          expectedRevision: 1,
        })
      ).status,
    ).toBe(409);
    expect((await call('post', `/${c.consentId}/decline`, consentHttpDeclineBody())).status).toBe(
      200,
    );
    expect((await call('post', `/${c.consentId}/decline`, consentHttpDeclineBody())).status).toBe(
      409,
    );
  });
  it('rejects closed/reopened Ticket requests, preserving historical status without access', async () => {
    const c = await created(),
      ticket = h.f.ticket();
    ticket.close(consentIds.actor, new Date());
    ticket.reopen(consentIds.actor, new Date(), consentIds.nextEpisode);
    expect((await call('post', '', consentHttpRequestBody())).status).toBe(409);
    h.f.authority.authorize.mockImplementationOnce(async (r) => consentActorFixture(r));
    const response = await request(h.app.getHttpServer())
      .get(`${base}/${c.consentId}`)
      .set('Authorization', `Bearer ${h.token()}`)
      .query({ ...consentHttpStatusQuery(), expectedTicketRevision: 2 });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ticketCompatibility: 'EPISODE_CHANGED',
      operationalAccess: false,
    });
  });
  it('rechecks Owner authority after independent verification awaits', async () => {
    h.f.authority.authorize.mockImplementationOnce(async (r) => {
      h.f.organization.members.length = 0;
      return consentActorFixture(r);
    });
    expect((await call('post', '', consentHttpRequestBody())).status).toBe(403);
    expect(h.f.consents.create).not.toHaveBeenCalled();
  });
  it.each(['grant', 'withdraw', 'expire', 'supersede', 'invalidate'])(
    'exposes no %s route',
    async (action) => {
      expect((await call('post', `/${fixed}/${action}`, {})).status).toBe(404);
    },
  );
  it('rejects unknown queries and malformed status revisions, ignoring GET bodies', async () => {
    const c = await created();
    for (const patch of [
      { actorId: 'forged' },
      { expectedTicketRevision: '1e0' },
      { expectedTicketRevision: ['0', '0'] },
      { expectedTicketRevision: '9007199254740992' },
    ])
      expect(
        (
          await request(h.app.getHttpServer())
            .get(`${base}/${c.consentId}`)
            .set('Authorization', `Bearer ${h.token()}`)
            .query({ ...consentHttpStatusQuery(), ...patch })
        ).status,
      ).toBe(400);
    expect(
      (
        await call('get', `/${c.consentId}`, {
          role: 'OWNER',
          organizationId: consentIds.foreignOrganization,
        })
      ).status,
    ).toBe(200);
  });
  it('does not confirm or retry unknown mutation outcomes, preserving safe reconciliation IDs', async () => {
    h.f.outcomes.next = 'UNCONFIRMED';
    h.f.outcomes.persistUnknown = true;
    const result = await call('post', '', consentHttpRequestBody());
    expect(result.status).toBe(503);
    expect(result.body.code).toBe('CUSTOMER_CONSENT_OUTCOME_UNCONFIRMED');
    expect(result.body.details[0]).toMatchObject({
      organizationId: consentIds.organization,
      ticketId: consentIds.ticket,
      episodeId: consentIds.episode,
      revision: 0,
      expectedRevision: null,
      retrySafe: false,
      mutationCommitted: 'unknown',
    });
    expect(h.f.records.has(result.body.details[0].consentId)).toBe(true);
    expect(h.f.consents.create).toHaveBeenCalledTimes(1);
  });
  it('does not restore VERIFIED_GRANTED through a status read', async () => {
    const c = await created();
    const p = h.f.records.get(c.consentId)!;
    Object.assign(p, { state: 'VERIFIED_GRANTED' });
    // Simulate a corrupt adapter return, then exercise E1 reconstitution.
    h.f.consents.findById.mockResolvedValueOnce({ toProps: () => p } as never);
    expect((await call('get', `/${c.consentId}`)).status).toBe(503);
  });
  it('captures detached DTO values and the principal before awaiting E1 authorization', async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let seen = false;
    const original = h.f.authority.authorize.getMockImplementation()!;
    h.f.authority.authorize.mockImplementationOnce(async (r) => {
      seen = true;
      await gate;
      return original(r);
    });
    const controller = h.module.get(CustomerConsentController),
      body = consentHttpRequestBody(),
      user = { userId: consentIds.actor, email: 'owner@example.invalid', isPlatformAdmin: false },
      params = { organizationId: consentIds.organization, ticketId: consentIds.ticket };
    const operation = controller.request(user, params, body, {});
    for (let i = 0; !seen && i < 50; i++) await Promise.resolve();
    expect(seen).toBe(true);
    user.userId = consentIds.beneficiary;
    params.organizationId = consentIds.foreignOrganization;
    body.proposal.scope.projectionId = 'forged';
    body.source.evidenceId = 'forged';
    finish();
    expect(await operation).toMatchObject({
      organizationId: consentIds.organization,
      state: 'PENDING_VERIFICATION',
      operationalAccess: false,
    });
    expect(isDeepStrictEqual(h.f.audits[0].metadata?.sourceEventId, 'request-1')).toBe(true);
  });
  it('returns safe fail-closed session/Owner storage errors', async () => {
    h.users.findById.mockRejectedValueOnce(new Error('private account store'));
    expect((await call('post', '', consentHttpRequestBody())).status).toBe(503);
    jest.spyOn(h.f.owner, 'authorize').mockRejectedValueOnce(
      new ServiceUnavailableException({
        code: 'SUPPORT_TICKET_AUTHORITY_UNAVAILABLE',
        message: 'Authority unavailable',
      }),
    );
    expect((await call('post', '', consentHttpRequestBody())).status).toBe(503);
    expect(h.module.get(RequestCustomerConsentService)).toBeDefined();
    expect(h.module.get(CustomerConsentContextService)).toBeDefined();
  });
});
