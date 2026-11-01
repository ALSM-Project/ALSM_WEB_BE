import { randomBytes, randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import type { DurableIntentConsumption } from '../src/modules/support/application/consent-verification-foundation.port';
import type { SyntheticConsentIntentRegistration } from '../src/modules/support/application/consent-intent-persistence.port';
import { consentDataCopy } from '../src/modules/support/domain/customer-consent.validation';
import { consentIds, consentRequestCommand } from './customer-consent.fixtures';

/** Synthetic assertions only; these issuers and the fixture lifetime are NOT approved policy. */
export function intentFixture(
  options: {
    action?: 'REQUEST' | 'DECLINE';
    actorUserId?: string;
    organizationId?: string;
    proofId?: string;
    proofRevision?: string;
    challengeId?: string;
    nonceSha256?: string;
  } = {},
): DurableIntentConsumption {
  const c = consentRequestCommand(),
    actor = options.actorUserId ?? consentIds.actor;
  const organizationId = options.organizationId ?? consentIds.organization;
  const action = options.action ?? 'REQUEST',
    at = Date.now() - 100;
  const source = {
    authorityId: 'synthetic-intent-channel',
    evidenceId: options.proofId ?? randomUUID(),
    revision: options.proofRevision ?? 'r1',
    generation: 'g1',
  };
  const policy = {
    reference: {
      authorityId: 'synthetic-policy-registry',
      evidenceId: 'fixture-policy',
      revision: 'r1',
      generation: 'g1',
      status: 'CURRENT' as const,
    },
    personIssuerId: 'synthetic-person-issuer',
    organisationIssuerId: 'synthetic-owner-issuer',
    channel: {
      kind: 'WEBAUTHN' as const,
      configuration: {
        authorityId: source.authorityId,
        evidenceId: 'fixture-rp',
        revision: 'r1',
        generation: 'g1',
      },
    },
    challengeLifetimeMs: 300_000, // Test policy only; no production default is provided.
  };
  const person = {
    personId: `synthetic-person-${actor}`,
    accountId: actor,
    provenance: {
      authorityId: policy.personIssuerId,
      evidenceId: `fixture-person-${actor}`,
      revision: 'r1',
      generation: 'g1',
      status: 'CURRENT' as const,
    },
  };
  const authority = {
    authorityId: policy.organisationIssuerId,
    evidenceId: `fixture-owner-${organizationId}-${actor}`,
    revision: 'r1',
    generation: 'g1',
    status: 'CURRENT' as const,
  };
  const { status, ...authorityRef } = authority;
  void status;
  const { status: policyStatus, ...policyRef } = policy.reference;
  void policyStatus;
  const binding = {
    action,
    actorUserId: actor,
    ticket: { organizationId, ticketId: randomUUID(), episodeId: randomUUID() },
    ticketRevision: 0,
    consentId: randomUUID(),
    expectedConsentRevision: action === 'DECLINE' ? 0 : null,
    scope: c.scope,
    proposal: action === 'REQUEST' ? c.proposal : null,
    source,
    invalidationReason: null,
  };
  const request = { ...binding, verificationAttemptId: randomUUID() };
  const challengeId = options.challengeId ?? randomUUID();
  const nonceSha256 = options.nonceSha256 ?? randomBytes(32).toString('hex');
  return consentDataCopy({
    consumptionId: randomUUID(),
    request,
    policy,
    evidence: {
      request,
      person: { ...person, issuerSubject: `fixture-subject-${actor}` },
      organisationAuthority: {
        organizationId,
        kind: 'ORGANIZATION_OWNER',
        person,
        provenance: authority,
      },
      challenge: {
        challengeId,
        nonceSha256,
        request: binding,
        person,
        organisationAuthority: authorityRef,
        channel: policy.channel,
        policy: policyRef,
        issuedAtMs: at,
        expiresAtMs: at + policy.challengeLifetimeMs,
        state: 'ISSUED',
      },
      intent: {
        challengeId,
        nonceSha256,
        request: binding,
        person,
        organisationAuthority: authorityRef,
        channel: policy.channel,
        credential: {
          authorityId: source.authorityId,
          evidenceId: `fixture-credential-${actor}`,
          revision: 'r1',
          generation: 'g1',
          status: 'CURRENT',
        },
        provenance: { ...source, status: 'CURRENT' },
        verifiedAtMs: at + 1,
      },
      originalGrantor:
        action === 'DECLINE' ? { personId: person.personId, accountId: actor } : null,
    },
  });
}
export function intentRegistration(
  input: DurableIntentConsumption,
): SyntheticConsentIntentRegistration {
  return consentDataCopy({
    request: input.request,
    policy: input.policy,
    evidence: input.evidence,
  });
}
export function intentReconciliation(input: DurableIntentConsumption) {
  return consentDataCopy({
    consumptionId: input.consumptionId,
    request: input.request,
    challengeId: input.evidence.challenge.challengeId,
  });
}
/** Reverse every object field order without changing values or array order. */
export function intentReordered<T>(value: T): T {
  if (Array.isArray(value)) return value.map(intentReordered) as T;
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, child]) => [key, intentReordered(child)]),
    ) as T;
  return value;
}
export function intentBsonCopy<T>(value: T): T {
  if (value instanceof Types.ObjectId) return new Types.ObjectId(value.toHexString()) as T;
  if (value instanceof Date) return new Date(value) as T;
  if (Array.isArray(value)) return value.map(intentBsonCopy) as T;
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, intentBsonCopy(child)]),
    ) as T;
  return value;
}
