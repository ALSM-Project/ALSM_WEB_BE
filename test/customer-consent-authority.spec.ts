import type {
  CustomerConsentActorAuthorization,
  CustomerConsentAuthorityInput,
  CustomerConsentAuthorityRequest,
} from '../src/modules/support/application/customer-consent-authority.port';
import { CustomerConsentContextService } from '../src/modules/support/application/customer-consent-context.service';
import {
  consentActorFixture,
  consentApplicationFixture,
  consentIds,
  consentRequestCommand,
  consentSourceFixture,
} from './customer-consent.fixtures';

function authorityInput(
  action: CustomerConsentAuthorityRequest['action'] = 'REQUEST',
): CustomerConsentAuthorityInput {
  const c = consentRequestCommand();
  return {
    action,
    actorUserId: c.actorUserId,
    ticket: {
      organizationId: c.organizationId,
      ticketId: c.ticketId,
      episodeId: c.episodeId,
    },
    ticketRevision: c.expectedTicketRevision,
    consentId: consentIds.consent,
    expectedConsentRevision: action === 'DECLINE' || action === 'INVALIDATE' ? 0 : null,
    scope: c.scope,
    proposal: action === 'REQUEST' ? c.proposal : null,
    source: action === 'STATUS' ? null : c.source,
    invalidationReason: action === 'INVALIDATE' ? 'TICKET_CLOSED' : null,
  };
}

/** Consumer checks only. Synthetic responses do NOT certify person/intent authentication. */
describe('E4 Customer Consent authority verification boundary (no production provider)', () => {
  it('creates detached, frozen invocation binding that the caller cannot select', async () => {
    const f = consentApplicationFixture();
    const input = { ...authorityInput(), verificationAttemptId: 'caller-selected' };
    const result = await f.context.authorize(input);
    const [bound] = f.authority.authorize.mock.calls[0];
    expect(bound.verificationAttemptId).toMatch(/^[a-f0-9-]{36}$/);
    expect(bound.verificationAttemptId).not.toBe(input.verificationAttemptId);
    expect(bound).not.toBe(input);
    expect(Object.isFrozen(bound)).toBe(true);
    expect(Object.isFrozen(bound.ticket)).toBe(true);
    expect(Object.isFrozen(bound.proposal!.beneficiary.identity)).toBe(true);
    expect(Object.isFrozen(result.actor)).toBe(true);
    expect(result.actor.accountId).toBe(consentIds.actor);
  });

  const mismatches: [string, (a: CustomerConsentActorAuthorization) => void][] = [
    ['actor account', (a) => Object.assign(a.actor, { accountId: consentIds.beneficiary })],
    ['actor in request', (a) => Object.assign(a.request, { actorUserId: consentIds.beneficiary })],
    [
      'Owner Organisation',
      (a) => Object.assign(a.customerAuthority, { organizationId: consentIds.foreignOrganization }),
    ],
    [
      'Owner kind',
      (a) => Object.assign(a.customerAuthority, { kind: 'AUTHORIZED_REPRESENTATIVE' }),
    ],
    [
      'Ticket Organisation',
      (a) => Object.assign(a.request.ticket, { organizationId: consentIds.foreignOrganization }),
    ],
    ['Ticket', (a) => Object.assign(a.request.ticket, { ticketId: consentIds.nextEpisode })],
    ['episode', (a) => Object.assign(a.request.ticket, { episodeId: consentIds.nextEpisode })],
    ['purpose', (a) => Object.assign(a.request.scope, { purposeId: 'other-purpose' })],
    ['operation', (a) => Object.assign(a.request.scope, { operation: 'UC66_READ_LOGS' })],
    ['projection', (a) => Object.assign(a.request.scope, { projectionId: 'other-projection' })],
    ['environment', (a) => Object.assign(a.request.scope, { environmentId: 'other-environment' })],
    ['use case', (a) => Object.assign(a.request.scope, { useCase: 'UC67' })],
    ['mode', (a) => Object.assign(a.request.scope, { mode: 'CUSTOMER_WRITE' })],
    ['action', (a) => Object.assign(a.request, { action: 'DECLINE' })],
    ['Consent', (a) => Object.assign(a.request, { consentId: consentIds.nextEpisode })],
    ['Ticket revision', (a) => Object.assign(a.request, { ticketRevision: 1 })],
    ['Consent revision', (a) => Object.assign(a.request, { expectedConsentRevision: 1 })],
    ['source issuer', (a) => Object.assign(a.request.source!, { authorityId: 'untrusted-source' })],
    ['source intent', (a) => Object.assign(a.request.source!, { evidenceId: 'other-intent' })],
    ['source revision', (a) => Object.assign(a.request.source!, { revision: 'old-revision' })],
    [
      'source generation',
      (a) => Object.assign(a.request.source!, { generation: 'old-generation' }),
    ],
    ['missing source', (a) => Object.assign(a.request, { source: null })],
    [
      'proposed person/account linkage',
      (a) => Object.assign(a.request.proposal!.beneficiary.identity, { personId: 'forged-person' }),
    ],
    [
      'proposed policy',
      (a) => Object.assign(a.request.proposal!.policy, { sha256: 'b'.repeat(64) }),
    ],
    [
      'invalidation reason',
      (a) => Object.assign(a.request, { invalidationReason: 'TICKET_CLOSED' }),
    ],
    ['verification attempt', (a) => Object.assign(a.request, { verificationAttemptId: 'old' })],
  ];
  it.each(mismatches)('rejects inconsistent %s evidence before a write', async (_name, mutate) => {
    const f = consentApplicationFixture();
    f.authority.authorize.mockImplementationOnce(async (r) => {
      const a = consentActorFixture(r);
      mutate(a);
      return a;
    });
    await expect(f.request.execute(consentRequestCommand())).rejects.toMatchObject({ status: 403 });
    expect(f.consents.create).not.toHaveBeenCalled();
    expect(f.audits).toEqual([]);
  });

  it.each(['STALE', 'REVOKED', 'EXPIRED', 'INVALIDATED', 'SUPERSEDED', 'UNKNOWN'] as const)(
    'rejects %s person linkage and Owner provenance',
    async (status) => {
      for (const evidence of ['person', 'Owner'] as const) {
        const f = consentApplicationFixture();
        f.authority.authorize.mockImplementationOnce(async (r) => {
          const a = consentActorFixture(r);
          Object.assign(evidence === 'person' ? a.actor.provenance : a.customerAuthority.evidence, {
            status,
          });
          return a;
        });
        await expect(f.request.execute(consentRequestCommand())).rejects.toMatchObject({
          status: 403,
        });
        expect(f.consents.create).not.toHaveBeenCalled();
      }
    },
  );

  it.each(['REQUEST', 'STATUS', 'DECLINE', 'INVALIDATE'] as const)(
    'rejects reuse of a %s response even for identical application input',
    async (action) => {
      const f = consentApplicationFixture();
      const input = authorityInput(action);
      const previous = await f.context.authorize(input);
      f.authority.authorize.mockResolvedValueOnce(previous);
      await expect(f.context.authorize(input)).rejects.toMatchObject({ status: 403 });
      const ids = f.authority.authorize.mock.calls.map(([r]) => r.verificationAttemptId);
      expect(new Set(ids).size).toBe(2);
    },
  );
  it('rejects duplicate delivery of one response to concurrent identical verifications', async () => {
    const f = consentApplicationFixture();
    let response: CustomerConsentActorAuthorization | undefined;
    f.authority.authorize.mockImplementation(async (r) => (response ??= consentActorFixture(r)));
    const results = await Promise.allSettled([
      f.context.authorize(authorityInput()),
      f.context.authorize(authorityInput()),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ reason: { status: 403 } });
  });
  it('rejects a cached STATUS response through E1 before reading Consent again', async () => {
    const f = consentApplicationFixture();
    const created = await f.request.execute(consentRequestCommand());
    const command = { ...consentRequestCommand(), consentId: created.consent.consentId };
    let response: CustomerConsentActorAuthorization | undefined;
    f.authority.authorize.mockImplementation(async (r) => (response ??= consentActorFixture(r)));
    expect(await f.status.execute(command)).toMatchObject({ operationalAccess: false });
    f.consents.findById.mockClear();
    await expect(f.status.execute(command)).rejects.toMatchObject({ status: 403 });
    expect(f.consents.findById).not.toHaveBeenCalled();
  });

  it.each(['REQUEST', 'STATUS', 'DECLINE', 'INVALIDATE'] as const)(
    'fails closed for %s without a provider, on an unavailable source, or without verified intent',
    async (action) => {
      const f = consentApplicationFixture();
      const missing = new CustomerConsentContextService(f.tickets, f.owner);
      await expect(missing.authorize(authorityInput(action))).rejects.toMatchObject({
        status: 403,
      });
      f.authority.authorize.mockRejectedValueOnce(new Error('private authority/consumption error'));
      await expect(f.context.authorize(authorityInput(action))).rejects.toMatchObject({
        status: 503,
        response: {
          code: 'CUSTOMER_CONSENT_AUTHORITY_UNAVAILABLE',
          message: 'Customer Consent authority could not be verified',
        },
      });
      f.authority.authorize.mockResolvedValueOnce(null);
      await expect(f.context.authorize(authorityInput(action))).rejects.toMatchObject({
        status: 403,
      });
      expect(f.authority.authorize).toHaveBeenCalledTimes(2);
      expect(f.consents.create).not.toHaveBeenCalled();
      expect(f.consents.save).not.toHaveBeenCalled();
    },
  );
  it.each([
    'array',
    'conflicting-person',
    'self-verified-intent',
    'positive-grant',
    'operational-access',
    '__proto__',
    'prototype',
    'constructor',
  ])('rejects ambiguous or extra authority response data: %s', async (kind) => {
    const f = consentApplicationFixture();
    f.authority.authorize.mockImplementationOnce(async (r) => {
      const a = consentActorFixture(r);
      if (kind === 'array') return [a, a] as unknown as CustomerConsentActorAuthorization;
      if (kind === 'conflicting-person')
        Object.assign(a.actor, { alternatePersonId: 'another-person' });
      else if (kind === 'self-verified-intent')
        Object.assign(a, { sourceIntent: { ...r.source, status: 'CURRENT', verified: true } });
      else if (kind === 'positive-grant') Object.assign(a, { state: 'VERIFIED_GRANTED' });
      else if (kind === 'operational-access') Object.assign(a, { operationalAccess: true });
      else Object.defineProperty(a, kind, { value: { verified: true }, enumerable: true });
      return a;
    });
    await expect(f.request.execute(consentRequestCommand())).rejects.toMatchObject({ status: 403 });
    expect(f.consents.create).not.toHaveBeenCalled();
  });
  it.each(['person', 'account'] as const)(
    'requires the original persisted grantor %s for DECLINE',
    async (kind) => {
      const f = consentApplicationFixture();
      const created = await f.request.execute(consentRequestCommand());
      // A second current Owner account for the same verified person is still not
      // the original grantor account. Let it pass the ordinary Owner prerequisite.
      if (kind === 'account')
        f.organization.members.push({
          ...f.organization.members[0],
          userId: consentIds.beneficiary,
        });
      f.authority.authorize.mockImplementationOnce(async (r) => {
        const a = consentActorFixture(r);
        if (kind === 'person') Object.assign(a.actor, { personId: 'successor-owner' });
        return a;
      });
      await expect(
        f.transition.execute({
          ...consentRequestCommand(),
          actorUserId: kind === 'account' ? consentIds.beneficiary : consentIds.actor,
          consentId: created.consent.consentId,
          expectedRevision: 0,
          action: 'DECLINE',
          source: consentSourceFixture('decline'),
        }),
      ).rejects.toMatchObject({ status: 403 });
      expect(f.consents.save).not.toHaveBeenCalled();
      expect(f.records.get(created.consent.consentId)!.state).toBe('PENDING_VERIFICATION');
      expect(f.audits).toHaveLength(1);
    },
  );
});
