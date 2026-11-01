import { ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { consentDataCopy } from '../src/modules/support/domain/customer-consent.validation';
import type { CustomerConsentAuthorityRequest } from '../src/modules/support/application/customer-consent-authority.port';
import type {
  ConsentVerificationEvidence,
  ConsentVerificationPolicy,
  DurableIntentConsumption,
  DurableIntentConsumptionResult,
} from '../src/modules/support/application/consent-verification-foundation.port';
import { VerifyConsentActionFoundationService } from '../src/modules/support/application/verify-consent-action-foundation.service';
import { OrganizationRole } from '../src/modules/organizations/domain/organization.types';
import {
  consentApplicationFixture,
  consentIds,
  consentRequestCommand,
} from './customer-consent.fixtures';

const now = 1_800_000_000_000;
function reference(value: {
  authorityId: string;
  evidenceId: string;
  revision: string;
  generation: string;
}) {
  const { authorityId, evidenceId, revision, generation } = value;
  return { authorityId, evidenceId, revision, generation };
}
function receipt(
  input: DurableIntentConsumption,
  outcome: DurableIntentConsumptionResult['outcome'] = 'CONFIRMED',
) {
  return {
    outcome,
    consumptionId: input.consumptionId,
    verificationAttemptId: input.request.verificationAttemptId,
    challengeId: input.evidence.challenge.challengeId,
  };
}
/** All issuers, policy values, intent and consumption here are SYNTHETIC, not approved policy. */
function fixture(action: 'REQUEST' | 'DECLINE' = 'REQUEST') {
  const f = consentApplicationFixture(),
    c = consentRequestCommand();
  const request: CustomerConsentAuthorityRequest = {
    verificationAttemptId: randomUUID(),
    action,
    actorUserId: c.actorUserId,
    ticket: { organizationId: c.organizationId, ticketId: c.ticketId, episodeId: c.episodeId },
    ticketRevision: 0,
    consentId: consentIds.consent,
    expectedConsentRevision: action === 'DECLINE' ? 0 : null,
    scope: c.scope,
    proposal: action === 'REQUEST' ? c.proposal : null,
    source: c.source,
    invalidationReason: null,
  };
  const policy: ConsentVerificationPolicy = {
    reference: {
      authorityId: 'synthetic-policy-registry',
      evidenceId: 'policy',
      revision: 'r1',
      generation: 'g1',
      status: 'CURRENT',
    },
    personIssuerId: 'synthetic-person-issuer',
    organisationIssuerId: 'synthetic-org-issuer',
    channel: {
      kind: 'WEBAUTHN',
      configuration: { ...c.source, evidenceId: 'synthetic-rp-configuration' },
    },
    challengeLifetimeMs: 60_000, // Fixture value only; production has no TTL default/configuration.
  };
  const person = {
    personId: 'proofed-person',
    accountId: c.actorUserId,
    provenance: {
      authorityId: policy.personIssuerId,
      evidenceId: 'person-binding',
      revision: 'r1',
      generation: 'g1',
      status: 'CURRENT' as const,
    },
  };
  const authority = {
    authorityId: policy.organisationIssuerId,
    evidenceId: 'owner-binding',
    revision: 'r1',
    generation: 'g1',
    status: 'CURRENT' as const,
  };
  const { verificationAttemptId, ...binding } = request;
  void verificationAttemptId;
  const challengeId = randomUUID();
  const evidence: ConsentVerificationEvidence = consentDataCopy({
    request,
    person: { ...person, issuerSubject: 'independently-enrolled-test-subject' },
    organisationAuthority: {
      organizationId: c.organizationId,
      kind: 'ORGANIZATION_OWNER',
      person,
      provenance: authority,
    },
    challenge: {
      challengeId,
      nonceSha256: 'c'.repeat(64),
      request: binding,
      person,
      organisationAuthority: reference(authority),
      channel: policy.channel,
      policy: reference(policy.reference),
      issuedAtMs: now - 1000,
      expiresAtMs: now - 1000 + policy.challengeLifetimeMs,
      state: 'ISSUED',
    },
    intent: {
      challengeId,
      nonceSha256: 'c'.repeat(64),
      request: binding,
      person,
      organisationAuthority: reference(authority),
      channel: policy.channel,
      credential: { ...c.source, evidenceId: 'server-credential-linkage', status: 'CURRENT' },
      provenance: { ...c.source, status: 'CURRENT' },
      verifiedAtMs: now - 500,
    },
    originalGrantor:
      action === 'DECLINE' ? { personId: person.personId, accountId: person.accountId } : null,
  });
  const policies = { current: jest.fn(async () => policy as ConsentVerificationPolicy | null) };
  const source = {
    resolve: jest
      .fn<
        Promise<ConsentVerificationEvidence | null>,
        [{ request: CustomerConsentAuthorityRequest; policy: ConsentVerificationPolicy }]
      >()
      .mockImplementation(async () => consentDataCopy(evidence)),
  };
  const consumption = {
    consume: jest.fn(async (input: DurableIntentConsumption) => receipt(input)),
    reconcile: jest.fn(),
  };
  const service = new VerifyConsentActionFoundationService(f.owner, policies, source, consumption);
  return { ...f, request, policy, evidence, policies, source, consumption, service };
}

describe('E5A non-operational Consent verification foundation (synthetic ports)', () => {
  beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(now));
  afterEach(() => jest.restoreAllMocks());
  it.each(['REQUEST', 'DECLINE'] as const)(
    'only consumes %s intent, without creating Consent or access',
    async (action) => {
      const f = fixture(action);
      const result = await f.service.execute(f.request);
      expect(result).toEqual({
        outcome: 'CONSUMED',
        consumptionId: expect.any(String),
        operationalAccess: false,
      });
      expect(Object.keys(result).sort()).toEqual(['consumptionId', 'operationalAccess', 'outcome']);
      const [written] = f.consumption.consume.mock.calls[0];
      expect(Object.isFrozen(written)).toBe(true);
      expect(Object.isFrozen(written.evidence.intent.request.scope)).toBe(true);
      expect(f.policies.current).toHaveBeenCalledTimes(2);
      expect(f.consumption.consume).toHaveBeenCalledTimes(1);
      expect(f.consents.create).not.toHaveBeenCalled();
      expect(f.consents.save).not.toHaveBeenCalled();
      expect(f.authority.authorize).not.toHaveBeenCalled();
      expect(f.records.size).toBe(0);
    },
  );
  it.each(['Owner', 'policy', 'source', 'consumption'])(
    'fails closed without the %s dependency',
    async (missing) => {
      const f = fixture();
      const service = new VerifyConsentActionFoundationService(
        missing === 'Owner' ? undefined : f.owner,
        missing === 'policy' ? undefined : f.policies,
        missing === 'source' ? undefined : f.source,
        missing === 'consumption' ? undefined : f.consumption,
      );
      await expect(service.execute(f.request)).rejects.toMatchObject({ status: 403 });
      expect(f.source.resolve).not.toHaveBeenCalled();
      expect(f.consumption.consume).not.toHaveBeenCalled();
    },
  );
  it.each(['policy', 'source'] as const)(
    'denies missing/ambiguous %s evidence',
    async (missing) => {
      const f = fixture();
      if (missing === 'policy') f.policies.current.mockResolvedValueOnce(null);
      else f.source.resolve.mockResolvedValueOnce(null);
      await expect(f.service.execute(f.request)).rejects.toMatchObject({ status: 403 });
      expect(f.consumption.consume).not.toHaveBeenCalled();
    },
  );
  it.each(['MEMBER', 'ADMIN', 'SUPPORT'] as const)(
    'retains the existing Owner-only and staff-denial prerequisite: %s',
    async (role) => {
      const f = fixture();
      if (role === 'SUPPORT') f.staff.hasCurrentAssignment.mockResolvedValue(true);
      else
        f.organization.members[0].role =
          role === 'ADMIN' ? OrganizationRole.ADMIN : OrganizationRole.MEMBER;
      await expect(f.service.execute(f.request)).rejects.toMatchObject({ status: 403 });
      expect(f.policies.current).not.toHaveBeenCalled();
      expect(f.source.resolve).not.toHaveBeenCalled();
      expect(f.consumption.consume).not.toHaveBeenCalled();
    },
  );
  it.each(['Owner', 'policy', 'source'] as const)(
    'sanitizes an unavailable %s, including thrown ForbiddenException',
    async (unavailable) => {
      const f = fixture();
      const error = new ForbiddenException('private provider/credential details');
      if (unavailable === 'Owner') jest.spyOn(f.owner, 'authorize').mockRejectedValueOnce(error);
      if (unavailable === 'policy') f.policies.current.mockRejectedValueOnce(error);
      if (unavailable === 'source') f.source.resolve.mockRejectedValueOnce(error);
      const result = await f.service.execute(f.request).catch((e: unknown) => e);
      expect(result).toMatchObject({
        status: 503,
        response: { code: 'CONSENT_VERIFICATION_SOURCE_UNAVAILABLE' },
      });
      expect(JSON.stringify(result)).not.toContain('private provider');
      expect(f.consumption.consume).not.toHaveBeenCalled();
    },
  );

  const evidenceChanges: [string, (e: ConsentVerificationEvidence) => void][] = [
    ['account', (e) => Object.assign(e.person, { accountId: consentIds.beneficiary })],
    ['person linkage', (e) => Object.assign(e.person, { personId: 'forged-person' })],
    [
      'unapproved person issuer',
      (e) => Object.assign(e.person.provenance, { authorityId: 'client-issuer' }),
    ],
    [
      'unapproved Owner issuer',
      (e) => Object.assign(e.organisationAuthority.provenance, { authorityId: 'client-issuer' }),
    ],
    [
      'Organisation',
      (e) =>
        Object.assign(e.organisationAuthority, { organizationId: consentIds.foreignOrganization }),
    ],
    [
      'membership-only authority',
      (e) => Object.assign(e.organisationAuthority, { kind: 'MEMBERSHIP_ROLE' }),
    ],
    [
      'Owner person binding revision',
      (e) => Object.assign(e.organisationAuthority.person.provenance, { revision: 'old' }),
    ],
    ['actor', (e) => Object.assign(e.request, { actorUserId: consentIds.beneficiary })],
    [
      'Ticket',
      (e) => Object.assign(e.challenge.request.ticket, { ticketId: consentIds.nextEpisode }),
    ],
    [
      'episode',
      (e) => Object.assign(e.challenge.request.ticket, { episodeId: consentIds.nextEpisode }),
    ],
    ['purpose', (e) => Object.assign(e.challenge.request.scope, { purposeId: 'another-purpose' })],
    ['action', (e) => Object.assign(e.challenge.request, { action: 'DECLINE' })],
    [
      'projection',
      (e) => Object.assign(e.challenge.request.scope, { projectionId: 'another-projection' }),
    ],
    ['Ticket revision', (e) => Object.assign(e.intent.request, { ticketRevision: 1 })],
    [
      'Consent identity',
      (e) => Object.assign(e.intent.request, { consentId: consentIds.nextEpisode }),
    ],
    [
      'proposal',
      (e) => Object.assign(e.intent.request.proposal!.policy, { sha256: 'b'.repeat(64) }),
    ],
    ['invocation', (e) => Object.assign(e.request, { verificationAttemptId: randomUUID() })],
    [
      'copied source reference',
      (e) => Object.assign(e.intent.provenance, { evidenceId: 'other-proof' }),
    ],
    [
      'client-selected proof issuer',
      (e) => Object.assign(e.intent.provenance, { authorityId: 'client-issuer' }),
    ],
    ['revoked credential', (e) => Object.assign(e.intent.credential, { status: 'REVOKED' })],
    [
      'untrusted credential registry',
      (e) => Object.assign(e.intent.credential, { authorityId: 'client-registry' }),
    ],
    ['challenge ID', (e) => Object.assign(e.intent, { challengeId: randomUUID() })],
    ['nonce', (e) => Object.assign(e.intent, { nonceSha256: 'd'.repeat(64) })],
    [
      'Owner generation',
      (e) => Object.assign(e.intent.organisationAuthority, { generation: 'old' }),
    ],
    ['unapproved channel', (e) => Object.assign(e.intent.channel, { kind: 'EMAIL_CHECKBOX' })],
    [
      'unapproved RP configuration',
      (e) => Object.assign(e.challenge.channel.configuration, { revision: 'other' }),
    ],
    ['challenge policy', (e) => Object.assign(e.challenge.policy, { generation: 'old' })],
    ['missing intent', (e) => Object.assign(e, { intent: null })],
    ['ambiguous identity', (e) => Object.assign(e, { person: [e.person, e.person] })],
    ['self-verification flag', (e) => Object.assign(e.intent, { verified: true })],
    ['positive grant', (e) => Object.assign(e, { state: 'VERIFIED_GRANTED' })],
    ['operational access', (e) => Object.assign(e, { operationalAccess: true })],
    [
      'caller original grantor',
      (e) =>
        Object.assign(e, { originalGrantor: { personId: 'claim', accountId: consentIds.actor } }),
    ],
    [
      'expired challenge',
      (e) => Object.assign(e.challenge, { issuedAtMs: now - 60_000, expiresAtMs: now }),
    ],
    ['invented TTL', (e) => Object.assign(e.challenge, { expiresAtMs: now + 600_000 })],
    ['future verification', (e) => Object.assign(e.intent, { verifiedAtMs: now + 1 })],
    ['proof before challenge', (e) => Object.assign(e.intent, { verifiedAtMs: now - 1001 })],
  ];
  it.each(evidenceChanges)('rejects %s before consuming any intent', async (_name, mutate) => {
    const f = fixture();
    mutate(f.evidence);
    await expect(f.service.execute(f.request)).rejects.toMatchObject({ status: 403 });
    expect(f.consumption.consume).not.toHaveBeenCalled();
  });
  it.each(['STALE', 'REVOKED', 'EXPIRED', 'INVALIDATED', 'SUPERSEDED', 'UNKNOWN'] as const)(
    'rejects %s provenance from every source',
    async (status) => {
      for (const target of ['person', 'Owner', 'intent', 'policy']) {
        const f = fixture();
        const evidence =
          target === 'person'
            ? f.evidence.person.provenance
            : target === 'Owner'
              ? f.evidence.organisationAuthority.provenance
              : target === 'intent'
                ? f.evidence.intent.provenance
                : f.policy.reference;
        Object.assign(evidence, { status });
        await expect(f.service.execute(f.request)).rejects.toMatchObject({ status: 403 });
        expect(f.consumption.consume).not.toHaveBeenCalled();
      }
    },
  );
  it.each(['CONSUMED', 'REVOKED', 'UNKNOWN'])('rejects %s challenges', async (state) => {
    const f = fixture();
    Object.assign(f.evidence.challenge, { state });
    await expect(f.service.execute(f.request)).rejects.toMatchObject({ status: 403 });
    expect(f.consumption.consume).not.toHaveBeenCalled();
  });
  it.each(['personId', 'accountId'] as const)(
    'requires original-grantor %s for DECLINE',
    async (field) => {
      const f = fixture('DECLINE');
      Object.assign(f.evidence.originalGrantor!, {
        [field]: field === 'accountId' ? consentIds.beneficiary : 'successor-person',
      });
      await expect(f.service.execute(f.request)).rejects.toMatchObject({ status: 403 });
      expect(f.consumption.consume).not.toHaveBeenCalled();
    },
  );
  it.each(['GRANT', 'STATUS', 'INVALIDATE', 'WITHDRAW', 'EXPIRE', 'SUPERSEDE'])(
    'does not implement %s authority',
    async (action) => {
      const f = fixture();
      Object.assign(f.request, { action });
      await expect(f.service.execute(f.request)).rejects.toMatchObject({ status: 400 });
      expect(f.source.resolve).not.toHaveBeenCalled();
    },
  );
  it.each(['__proto__', 'prototype', 'constructor', 'verified', 'personId'])(
    'rejects extra request authority field %s',
    async (field) => {
      const f = fixture();
      Object.defineProperty(f.request, field, { value: { verified: true }, enumerable: true });
      await expect(f.service.execute(f.request)).rejects.toMatchObject({ status: 400 });
      expect(f.source.resolve).not.toHaveBeenCalled();
    },
  );
  it.each([undefined, 0, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'requires an explicit valid approved lifetime: %s',
    async (lifetime) => {
      const f = fixture();
      Object.assign(f.policy, { challengeLifetimeMs: lifetime });
      await expect(f.service.execute(f.request)).rejects.toMatchObject({ status: 403 });
      expect(f.consumption.consume).not.toHaveBeenCalled();
    },
  );

  it.each(['Owner', 'policy', 'expiry'])(
    'rejects observed %s changes while verification waits',
    async (change) => {
      const f = fixture();
      f.source.resolve.mockImplementationOnce(async () => {
        if (change === 'Owner') f.organization.members.length = 0;
        if (change === 'policy') Object.assign(f.policy.reference, { revision: 'changed' });
        if (change === 'expiry')
          jest.mocked(Date.now).mockReturnValue(f.evidence.challenge.expiresAtMs);
        return consentDataCopy(f.evidence);
      });
      await expect(f.service.execute(f.request)).rejects.toMatchObject({ status: 403 });
      expect(f.consumption.consume).not.toHaveBeenCalled();
    },
  );
  it('captures commands before awaiting the policy source', async () => {
    const f = fixture();
    let finish!: (p: ConsentVerificationPolicy) => void;
    f.policies.current.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const operation = f.service.execute(f.request);
    for (let i = 0; !finish && i < 30; i++) await Promise.resolve();
    expect(finish).toBeDefined();
    Object.assign(f.request, { actorUserId: consentIds.beneficiary, action: 'GRANT' });
    Object.assign(f.request.ticket, { organizationId: consentIds.foreignOrganization });
    finish(consentDataCopy(f.policy));
    expect(await operation).toMatchObject({ outcome: 'CONSUMED', operationalAccess: false });
    expect(f.consumption.consume.mock.calls[0][0].request).toMatchObject({
      actorUserId: consentIds.actor,
      action: 'REQUEST',
      ticket: { organizationId: consentIds.organization },
    });
  });
  it('detaches a mutable source response before the second policy await', async () => {
    const f = fixture();
    let finish!: (p: ConsentVerificationPolicy) => void;
    f.source.resolve.mockResolvedValueOnce(f.evidence);
    f.policies.current.mockResolvedValueOnce(consentDataCopy(f.policy)).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const operation = f.service.execute(f.request);
    for (let i = 0; !finish && i < 50; i++) await Promise.resolve();
    expect(finish).toBeDefined();
    Object.assign(f.evidence.person, { personId: 'mutated-after-capture' });
    finish(consentDataCopy(f.policy));
    await operation;
    expect(f.consumption.consume.mock.calls[0][0].evidence.person.personId).toBe('proofed-person');
  });
  it.each([
    'throw',
    'UNCONFIRMED',
    'malformed',
    'wrong-consumption',
    'wrong-attempt',
    'wrong-challenge',
  ])('never retries or confirms a consumption outcome: %s', async (kind) => {
    const f = fixture();
    f.consumption.consume.mockImplementationOnce(async (input) => {
      if (kind === 'throw') throw Error('private database failure');
      const value = receipt(input, 'UNCONFIRMED');
      if (kind === 'malformed') return true as unknown as DurableIntentConsumptionResult;
      if (kind === 'wrong-consumption') return { ...receipt(input), consumptionId: randomUUID() };
      if (kind === 'wrong-attempt')
        return { ...receipt(input), verificationAttemptId: randomUUID() };
      if (kind === 'wrong-challenge') return { ...receipt(input), challengeId: randomUUID() };
      return value;
    });
    const error = await f.service.execute(f.request).catch((e: unknown) => e);
    const [original] = f.consumption.consume.mock.calls[0];
    expect(error).toMatchObject({
      status: 503,
      response: {
        code: 'CONSENT_INTENT_CONSUMPTION_UNCONFIRMED',
        details: [
          expect.objectContaining({
            consumptionId: original.consumptionId,
            challengeId: original.evidence.challenge.challengeId,
            verificationAttemptId: original.request.verificationAttemptId,
            retrySafe: false,
            mutationCommitted: 'unknown',
          }),
        ],
      },
    });
    expect(JSON.stringify(error)).not.toContain('private database');
    expect(f.consumption.consume).toHaveBeenCalledTimes(1);
    expect(f.consumption.reconcile).not.toHaveBeenCalled();
  });
  it('models one consumption winner for concurrent invocations without claiming database atomicity', async () => {
    const f = fixture();
    f.source.resolve.mockImplementation(async ({ request: actual }) => {
      const e = consentDataCopy(f.evidence);
      Object.assign(e, { request: consentDataCopy(actual) });
      return e;
    });
    const next = { ...f.request, verificationAttemptId: randomUUID() };
    const consumed = new Set<string>();
    f.consumption.consume.mockImplementation(async (input) => {
      const id = input.evidence.challenge.challengeId;
      if (consumed.has(id)) return receipt(input, 'REJECTED');
      consumed.add(id);
      return receipt(input);
    });
    const outcomes = await Promise.allSettled([
      f.service.execute(f.request),
      f.service.execute(next),
    ]);
    expect(f.consumption.consume).toHaveBeenCalledTimes(2);
    expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find((r) => r.status === 'rejected')).toMatchObject({
      reason: { status: 403 },
    });
    expect(consumed.size).toBe(1);
  });
  it('models rejection of cross-action reuse even if a source reissues matching snapshots', async () => {
    const first = fixture('REQUEST'),
      second = fixture('DECLINE');
    Object.assign(second.evidence.challenge, { challengeId: first.evidence.challenge.challengeId });
    Object.assign(second.evidence.intent, { challengeId: first.evidence.challenge.challengeId });
    const used = new Set<string>();
    const consume = async (input: DurableIntentConsumption) => {
      const key = input.evidence.challenge.nonceSha256;
      if (used.has(key)) return receipt(input, 'REJECTED');
      used.add(key);
      return receipt(input);
    };
    first.consumption.consume.mockImplementation(consume);
    second.consumption.consume.mockImplementation(consume);
    await first.service.execute(first.request);
    await expect(second.service.execute(second.request)).rejects.toMatchObject({ status: 403 });
    expect(second.consumption.consume).toHaveBeenCalledTimes(1);
  });
  it('rejects a cached confirmed receipt for a fresh consumption invocation', async () => {
    const f = fixture();
    let cached: DurableIntentConsumptionResult | undefined;
    f.consumption.consume.mockImplementation(async (input) => (cached ??= receipt(input)));
    await f.service.execute(f.request);
    await expect(f.service.execute(f.request)).rejects.toMatchObject({
      status: 503,
      response: { code: 'CONSENT_INTENT_CONSUMPTION_UNCONFIRMED' },
    });
    expect(f.consumption.consume.mock.calls[0][0].consumptionId).not.toBe(
      f.consumption.consume.mock.calls[1][0].consumptionId,
    );
  });
  it.each(['getter', 'cycle', 'reserved-key'])(
    'rejects hostile source objects: %s',
    async (kind) => {
      const f = fixture();
      let getters = 0;
      if (kind === 'getter')
        Object.defineProperty(f.evidence.person, 'personId', {
          get() {
            getters++;
            throw Error('private getter');
          },
          enumerable: true,
        });
      if (kind === 'cycle') Object.assign(f.evidence, { cycle: f.evidence });
      if (kind === 'reserved-key')
        Object.defineProperty(f.evidence, '__proto__', {
          value: { verified: true },
          enumerable: true,
        });
      f.source.resolve.mockResolvedValueOnce(f.evidence);
      await expect(f.service.execute(f.request)).rejects.toMatchObject({ status: 403 });
      expect(getters).toBe(0);
      expect(f.consumption.consume).not.toHaveBeenCalled();
    },
  );
});
