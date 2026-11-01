import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { Types } from 'mongoose';
import type { AuditRepository } from '../../audit/domain/audit.repository';
import type { SyntheticConsentIntentRegistration } from '../application/consent-intent-persistence.port';
import type { DurableIntentConsumption } from '../application/consent-verification-foundation.port';
import {
  captureConsentVerificationRequest,
  captureConsentVerificationPolicy,
  captureConsentVerificationEvidence,
} from '../application/consent-verification-foundation.validation';
import {
  consentAccountId,
  consentDataCopy,
  consentEvidence,
  consentIdentifier,
  consentPerson,
  consentRevision,
  consentShape,
  consentSource,
  consentUuid,
  freezeConsentData,
  invalidConsent,
} from '../domain/customer-consent.validation';
import type { AuthorityEvidenceReference } from '../domain/ticket-consent-boundary.contracts';
import {
  CONSENT_INTENT_AUDIT_ACTION,
  CONSENT_INTENT_AUDIT_TYPE,
  CONSENT_INTENT_TRUST_MODE,
  ConsentIntentChallengeSnapshot,
  ConsentIntentContextFields,
  ConsentIntentReceiptSnapshot,
  ConsentIntentTrustKind,
  ConsentIntentTrustSnapshot,
} from './consent-intent.schema';

export function intentCanonical<T>(input: T): T {
  const copied = consentDataCopy(input);
  const sort = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sort);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, v]) => [key, sort(v)]),
      );
    return value;
  };
  return sort(copied) as T;
}
export const intentHash = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(intentCanonical(value)))
    .digest('hex');
const ref = (value: AuthorityEvidenceReference) => {
  const { authorityId, evidenceId, revision, generation } = value;
  return { authorityId, evidenceId, revision, generation };
};
export function captureIntentRegistration(input: SyntheticConsentIntentRegistration, atMs: number) {
  const c = consentDataCopy(input);
  consentShape(c, ['request', 'policy', 'evidence']);
  const request = captureConsentVerificationRequest(c.request);
  const policy = captureConsentVerificationPolicy(c.policy);
  const evidence = captureConsentVerificationEvidence(c.evidence, request, policy, atMs);
  return freezeConsentData(intentCanonical({ request, policy, evidence }));
}
export function captureIntentConsumption(input: DurableIntentConsumption, atMs: number) {
  const c = consentDataCopy(input);
  consentShape(c, ['consumptionId', 'request', 'policy', 'evidence']);
  consentUuid(c.consumptionId);
  return freezeConsentData({
    consumptionId: c.consumptionId,
    ...captureIntentRegistration(
      { request: c.request, policy: c.policy, evidence: c.evidence },
      atMs,
    ),
  });
}
export function intentContextFields(
  registration: SyntheticConsentIntentRegistration,
  registeredAtMs: number,
): ConsentIntentContextFields {
  const r = registration.request,
    proof = registration.evidence.intent.provenance;
  return {
    schemaVersion: 1,
    trustMode: CONSENT_INTENT_TRUST_MODE,
    organizationId: new Types.ObjectId(r.ticket.organizationId),
    actorUserId: new Types.ObjectId(r.actorUserId),
    ticketId: r.ticket.ticketId,
    episodeId: r.ticket.episodeId,
    verificationAttemptId: r.verificationAttemptId,
    proofIssuerId: proof.authorityId,
    proofId: proof.evidenceId,
    nonceSha256: registration.evidence.challenge.nonceSha256,
    contextHash: intentHash(registration),
    registration,
    registeredAtMs,
  };
}
export function intentChallenge(
  registration: SyntheticConsentIntentRegistration,
  atMs: number,
): ConsentIntentChallengeSnapshot {
  return {
    _id: registration.evidence.challenge.challengeId,
    ...intentContextFields(registration, atMs),
    state: 'ISSUED',
    revision: 0,
    consumptionId: null,
    consumedAtMs: null,
  };
}
const contextKeys = [
  'schemaVersion',
  'trustMode',
  'organizationId',
  'actorUserId',
  'ticketId',
  'episodeId',
  'verificationAttemptId',
  'proofIssuerId',
  'proofId',
  'nonceSha256',
  'contextHash',
  'registration',
  'registeredAtMs',
];
function own(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    invalidConsent();
  consentShape(value, keys);
  return Object.fromEntries(
    keys.map((key) => {
      const d = Object.getOwnPropertyDescriptor(value, key);
      if (!d || !('value' in d)) invalidConsent();
      return [key, d.value];
    }),
  );
}
function contextFromData(d: Record<string, unknown>): ConsentIntentContextFields {
  consentRevision(d.registeredAtMs);
  const registration = captureIntentRegistration(
    d.registration as SyntheticConsentIntentRegistration,
    d.registeredAtMs,
  );
  const expected = intentContextFields(registration, d.registeredAtMs);
  for (const key of contextKeys)
    if (!isDeepStrictEqual(d[key], expected[key as keyof ConsentIntentContextFields]))
      invalidConsent();
  return expected;
}
export function intentChallengeFromSnapshot(value: unknown): ConsentIntentChallengeSnapshot {
  const d = own(value, [
    '_id',
    ...contextKeys,
    'state',
    'revision',
    'consumptionId',
    'consumedAtMs',
  ]);
  const c = contextFromData(d);
  consentUuid(d._id);
  if (d._id !== c.registration.evidence.challenge.challengeId) invalidConsent();
  if (d.state === 'CONSUMED') {
    if (d.revision !== 1) invalidConsent();
    consentUuid(d.consumptionId);
    consentRevision(d.consumedAtMs);
    if (
      d.consumedAtMs < c.registeredAtMs ||
      d.consumedAtMs >= c.registration.evidence.challenge.expiresAtMs
    )
      invalidConsent();
  } else if (
    !['ISSUED', 'REVOKED'].includes(d.state as string) ||
    d.revision !== 0 ||
    d.consumptionId !== null ||
    d.consumedAtMs !== null
  )
    invalidConsent();
  return {
    ...c,
    _id: d._id,
    state: d.state,
    revision: d.revision,
    consumptionId: d.consumptionId,
    consumedAtMs: d.consumedAtMs,
  } as ConsentIntentChallengeSnapshot;
}
export function intentReceiptFromSnapshot(value: unknown): ConsentIntentReceiptSnapshot {
  const d = own(value, [
    '_id',
    ...contextKeys,
    'challengeId',
    'state',
    'revision',
    'consumedAtMs',
    'auditId',
  ]);
  const c = contextFromData(d);
  consentUuid(d._id);
  consentUuid(d.challengeId);
  consentRevision(d.consumedAtMs);
  if (
    d.challengeId !== c.registration.evidence.challenge.challengeId ||
    d.state !== 'CONSUMED' ||
    d.revision !== 1 ||
    !(d.auditId instanceof Types.ObjectId) ||
    d.consumedAtMs < c.registeredAtMs ||
    d.consumedAtMs >= c.registration.evidence.challenge.expiresAtMs
  )
    invalidConsent();
  return {
    ...c,
    _id: d._id,
    challengeId: d.challengeId,
    state: 'CONSUMED',
    revision: 1,
    consumedAtMs: d.consumedAtMs,
    auditId: d.auditId,
  };
}
export function intentTrustRecords(
  registration: SyntheticConsentIntentRegistration,
): ConsentIntentTrustSnapshot[] {
  const e = registration.evidence;
  const rows: [ConsentIntentTrustKind, AuthorityEvidenceReference, object][] = [
    ['POLICY', registration.policy.reference, registration.policy],
    ['PERSON', e.person.provenance, e.person],
    ['ORGANISATION_AUTHORITY', e.organisationAuthority.provenance, e.organisationAuthority],
    [
      'CREDENTIAL',
      e.intent.credential,
      { credential: e.intent.credential, person: e.intent.person, channel: e.intent.channel },
    ],
  ];
  return rows.map(([kind, reference, value]) => ({
    _id: intentHash([kind, reference.authorityId, reference.evidenceId]),
    schemaVersion: 1,
    trustMode: CONSENT_INTENT_TRUST_MODE,
    kind,
    reference: ref(reference),
    payload: intentCanonical(value),
    payloadHash: intentHash(value),
    state: 'CURRENT',
    fence: 0,
  }));
}
export function intentTrustFromSnapshot(value: unknown): ConsentIntentTrustSnapshot {
  const c = consentDataCopy(value) as ConsentIntentTrustSnapshot;
  consentShape(c, [
    '_id',
    'schemaVersion',
    'trustMode',
    'kind',
    'reference',
    'payload',
    'payloadHash',
    'state',
    'fence',
  ]);
  consentSource(c.reference);
  consentRevision(c.fence);
  if (
    c.schemaVersion !== 1 ||
    c.trustMode !== CONSENT_INTENT_TRUST_MODE ||
    !['CURRENT', 'REVOKED'].includes(c.state) ||
    c._id !== intentHash([c.kind, c.reference.authorityId, c.reference.evidenceId]) ||
    c.payloadHash !== intentHash(c.payload)
  )
    invalidConsent();
  const p = c.payload as Record<string, unknown>;
  let reference: AuthorityEvidenceReference;
  if (c.kind === 'POLICY') {
    reference = captureConsentVerificationPolicy(
      p as unknown as SyntheticConsentIntentRegistration['policy'],
    ).reference;
  } else if (c.kind === 'PERSON') {
    consentShape(p, ['personId', 'accountId', 'provenance', 'issuerSubject']);
    consentIdentifier(p.issuerSubject);
    consentPerson({
      personId: p.personId,
      accountId: p.accountId,
      provenance: p.provenance,
    } as SyntheticConsentIntentRegistration['evidence']['challenge']['person']);
    reference = p.provenance as AuthorityEvidenceReference;
  } else if (c.kind === 'ORGANISATION_AUTHORITY') {
    consentShape(p, ['organizationId', 'kind', 'person', 'provenance']);
    consentAccountId(p.organizationId);
    if (p.kind !== 'ORGANIZATION_OWNER') invalidConsent();
    consentPerson(
      p.person as SyntheticConsentIntentRegistration['evidence']['challenge']['person'],
    );
    reference = p.provenance as AuthorityEvidenceReference;
  } else if (c.kind === 'CREDENTIAL') {
    consentShape(p, ['credential', 'person', 'channel']);
    consentPerson(
      p.person as SyntheticConsentIntentRegistration['evidence']['challenge']['person'],
    );
    const channel = p.channel as SyntheticConsentIntentRegistration['policy']['channel'];
    consentShape(channel, ['kind', 'configuration']);
    if (channel.kind !== 'WEBAUTHN') invalidConsent();
    consentSource(channel.configuration);
    reference = p.credential as AuthorityEvidenceReference;
  } else invalidConsent();
  consentEvidence(reference);
  if (reference.status !== 'CURRENT' || !isDeepStrictEqual(c.reference, ref(reference)))
    invalidConsent();
  return freezeConsentData(c);
}
export function intentAudit(
  registration: SyntheticConsentIntentRegistration,
  consumptionId: string,
  consumedAtMs: number,
): Parameters<AuditRepository['append']>[0] {
  const r = registration.request,
    e = registration.evidence,
    person = e.person.provenance;
  return {
    actorUserId: r.actorUserId,
    organizationId: r.ticket.organizationId,
    action: CONSENT_INTENT_AUDIT_ACTION,
    resourceType: CONSENT_INTENT_AUDIT_TYPE,
    resourceId: consumptionId,
    metadata: {
      state: 'CONSUMED',
      challengeId: e.challenge.challengeId,
      proofIssuerId: e.intent.provenance.authorityId,
      proofId: e.intent.provenance.evidenceId,
      consumptionId,
      verificationAttemptId: r.verificationAttemptId,
      consentId: r.consentId,
      expectedConsentRevision:
        r.expectedConsentRevision === null ? 'none' : String(r.expectedConsentRevision),
      ticketId: r.ticket.ticketId,
      episodeId: r.ticket.episodeId,
      purposeId: r.scope.purposeId,
      consentAction: r.action,
      ticketRevision: String(r.ticketRevision),
      contextHash: intentHash(registration),
      consumedAtMs: String(consumedAtMs),
      personBindingIssuer: person.authorityId,
      personBindingId: person.evidenceId,
      personBindingRevision: person.revision,
      personBindingGeneration: person.generation,
    },
  };
}
/** Raw audit BSON is compared to the exact attribution; no ordinary unbound audit suffices. */
export function intentAuditId(
  value: unknown,
  expected: Parameters<AuditRepository['append']>[0],
): Types.ObjectId {
  if (!value || typeof value !== 'object') invalidConsent();
  const keys = [
    '_id',
    'createdAt',
    'actorUserId',
    'organizationId',
    'action',
    'resourceType',
    'resourceId',
    'metadata',
  ];
  if (Object.hasOwn(value, '__v')) keys.push('__v');
  const d = own(value, keys);
  if (
    !(d._id instanceof Types.ObjectId) ||
    !(d.createdAt instanceof Date) ||
    !Number.isFinite(d.createdAt.getTime()) ||
    (Object.hasOwn(d, '__v') && d.__v !== 0) ||
    !(d.actorUserId instanceof Types.ObjectId) ||
    !(d.organizationId instanceof Types.ObjectId)
  )
    invalidConsent();
  if (
    !isDeepStrictEqual(
      {
        actorUserId: d.actorUserId.toHexString(),
        organizationId: d.organizationId.toHexString(),
        action: d.action,
        resourceType: d.resourceType,
        resourceId: d.resourceId,
        metadata: consentDataCopy(d.metadata),
      },
      expected,
    )
  )
    invalidConsent();
  return d._id;
}
