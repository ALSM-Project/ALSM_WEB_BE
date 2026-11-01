import { isDeepStrictEqual } from 'node:util';
import {
  consentAccountId,
  consentDataCopy,
  consentEvidence,
  consentIdentifier,
  consentPerson,
  consentProposal,
  consentRevision,
  consentScope,
  consentShape,
  consentSource,
  consentUuid,
  freezeConsentData,
  invalidConsent,
} from '../domain/customer-consent.validation';
import type {
  AuthorityEvidenceReference,
  AuthorityRevisionReference,
} from '../domain/ticket-consent-boundary.contracts';
import type { CustomerConsentAuthorityRequest } from './customer-consent-authority.port';
import type {
  ConsentIntentChannel,
  ConsentVerificationEvidence,
  ConsentVerificationPolicy,
} from './consent-verification-foundation.port';

function same(left: unknown, right: unknown): void {
  if (!isDeepStrictEqual(left, right)) invalidConsent();
}
function reference(value: AuthorityEvidenceReference): AuthorityRevisionReference {
  const { authorityId, evidenceId, revision, generation } = value;
  return { authorityId, evidenceId, revision, generation };
}
function current(value: AuthorityEvidenceReference, issuer?: string): void {
  consentEvidence(value);
  if (value.status !== 'CURRENT' || (issuer !== undefined && value.authorityId !== issuer))
    invalidConsent();
}
function channel(value: ConsentIntentChannel): void {
  consentShape(value, ['kind', 'configuration']);
  if (value.kind !== 'WEBAUTHN') invalidConsent();
  consentSource(value.configuration);
}

/** Shape/binding validation only. Never authenticates an issuer, person or action. */
export function captureConsentVerificationRequest(input: CustomerConsentAuthorityRequest) {
  const r = consentDataCopy(input);
  consentShape(r, [
    'verificationAttemptId',
    'action',
    'actorUserId',
    'ticket',
    'ticketRevision',
    'consentId',
    'expectedConsentRevision',
    'scope',
    'proposal',
    'source',
    'invalidationReason',
  ]);
  consentUuid(r.verificationAttemptId);
  consentAccountId(r.actorUserId);
  consentShape(r.ticket, ['organizationId', 'ticketId', 'episodeId']);
  consentAccountId(r.ticket.organizationId);
  [r.ticket.ticketId, r.ticket.episodeId, r.consentId].forEach(consentUuid);
  consentRevision(r.ticketRevision);
  consentScope(r.scope);
  if (!r.source || r.invalidationReason !== null) invalidConsent();
  consentSource(r.source);
  if (r.action === 'REQUEST') {
    if (!r.proposal || r.expectedConsentRevision !== null) invalidConsent();
    consentProposal(r.proposal);
    same(r.proposal.scope, r.scope);
  } else if (r.action === 'DECLINE') {
    if (r.proposal !== null) invalidConsent();
    consentRevision(r.expectedConsentRevision);
  } else invalidConsent(); // E5A defines no grant, status or lifecycle authority.
  return freezeConsentData(r);
}

export function captureConsentVerificationPolicy(input: ConsentVerificationPolicy) {
  const p = consentDataCopy(input);
  consentShape(p, [
    'reference',
    'personIssuerId',
    'organisationIssuerId',
    'channel',
    'challengeLifetimeMs',
  ]);
  current(p.reference);
  [p.personIssuerId, p.organisationIssuerId].forEach(consentIdentifier);
  channel(p.channel);
  consentRevision(p.challengeLifetimeMs);
  if (p.challengeLifetimeMs === 0) invalidConsent();
  return freezeConsentData(p);
}

export function captureConsentVerificationEvidence(
  input: ConsentVerificationEvidence,
  request: CustomerConsentAuthorityRequest,
  policy: ConsentVerificationPolicy,
  nowMs: number,
) {
  const e = consentDataCopy(input);
  consentShape(e, [
    'request',
    'person',
    'organisationAuthority',
    'challenge',
    'intent',
    'originalGrantor',
  ]);
  same(e.request, request);
  consentShape(e.person, ['personId', 'accountId', 'provenance', 'issuerSubject']);
  const identity = {
    personId: e.person.personId,
    accountId: e.person.accountId,
    provenance: e.person.provenance,
  };
  consentPerson(identity);
  consentIdentifier(e.person.issuerSubject);
  current(e.person.provenance, policy.personIssuerId);
  same(e.person.accountId, request.actorUserId);
  const a = e.organisationAuthority;
  consentShape(a, ['organizationId', 'kind', 'person', 'provenance']);
  same(a.organizationId, request.ticket.organizationId);
  if (a.kind !== 'ORGANIZATION_OWNER') invalidConsent();
  same(a.person, identity);
  current(a.provenance, policy.organisationIssuerId);

  const { verificationAttemptId, ...binding } = request;
  void verificationAttemptId;
  const c = e.challenge;
  consentShape(c, [
    'challengeId',
    'nonceSha256',
    'request',
    'person',
    'organisationAuthority',
    'channel',
    'policy',
    'issuedAtMs',
    'expiresAtMs',
    'state',
  ]);
  consentUuid(c.challengeId);
  if (typeof c.nonceSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(c.nonceSha256)) invalidConsent();
  same(c.request, binding);
  same(c.person, identity);
  same(c.organisationAuthority, reference(a.provenance));
  same(c.channel, policy.channel);
  same(c.policy, reference(policy.reference));
  if (c.state !== 'ISSUED') invalidConsent();
  const intent = e.intent;
  consentShape(intent, [
    'challengeId',
    'nonceSha256',
    'request',
    'person',
    'organisationAuthority',
    'channel',
    'credential',
    'provenance',
    'verifiedAtMs',
  ]);
  same(intent.challengeId, c.challengeId);
  same(intent.nonceSha256, c.nonceSha256);
  same(intent.request, binding);
  same(intent.person, identity);
  same(intent.organisationAuthority, c.organisationAuthority);
  same(intent.channel, policy.channel);
  current(intent.credential, policy.channel.configuration.authorityId);
  current(intent.provenance, policy.channel.configuration.authorityId);
  same(reference(intent.provenance), request.source);
  [nowMs, c.issuedAtMs, c.expiresAtMs, intent.verifiedAtMs].forEach(consentRevision);
  if (
    c.expiresAtMs - c.issuedAtMs !== policy.challengeLifetimeMs ||
    c.issuedAtMs > intent.verifiedAtMs ||
    intent.verifiedAtMs > nowMs ||
    nowMs >= c.expiresAtMs
  )
    invalidConsent();
  if (request.action === 'DECLINE') {
    consentShape(e.originalGrantor, ['personId', 'accountId']);
    same(e.originalGrantor, { personId: identity.personId, accountId: identity.accountId });
  } else if (e.originalGrantor !== null) invalidConsent();
  return freezeConsentData(e);
}
