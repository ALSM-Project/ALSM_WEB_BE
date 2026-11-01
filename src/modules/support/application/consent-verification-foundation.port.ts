import type {
  AuthorityEvidenceReference,
  AuthorityRevisionReference,
  PersonAccountEvidenceReference,
} from '../domain/ticket-consent-boundary.contracts';
import type {
  CustomerConsentAuthorityInput,
  CustomerConsentAuthorityRequest,
} from './customer-consent-authority.port';

/** Non-operational snapshots: types and CURRENT labels do not establish trust. */
export interface VerifiedPersonBinding extends PersonAccountEvidenceReference {
  readonly issuerSubject: string;
}
export interface VerifiedOrganisationAuthority {
  readonly organizationId: string;
  readonly kind: 'ORGANIZATION_OWNER';
  readonly person: PersonAccountEvidenceReference;
  readonly provenance: AuthorityEvidenceReference;
}
/** Proposed channel only; no RP, origin, credential registry or verifier is configured. */
export interface ConsentIntentChannel {
  readonly kind: 'WEBAUTHN';
  readonly configuration: AuthorityRevisionReference;
}
export interface ConsentVerificationPolicy {
  readonly reference: AuthorityEvidenceReference;
  readonly personIssuerId: string;
  readonly organisationIssuerId: string;
  readonly channel: ConsentIntentChannel;
  /** Must come from an approved server policy; no default or selected value. */
  readonly challengeLifetimeMs: number;
}
export interface ConsentActionChallenge {
  readonly challengeId: string;
  /** Digest of an unpredictable server nonce, never a proof of intent by itself. */
  readonly nonceSha256: string;
  /** Stable transaction binding excludes E4's later, per-invocation correlation. */
  readonly request: CustomerConsentAuthorityInput;
  readonly person: PersonAccountEvidenceReference;
  readonly organisationAuthority: AuthorityRevisionReference;
  readonly channel: ConsentIntentChannel;
  readonly policy: AuthorityRevisionReference;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
  readonly state: 'ISSUED' | 'CONSUMED' | 'REVOKED' | 'UNKNOWN';
}
export interface VerifiedConsentActionIntent {
  readonly challengeId: string;
  readonly nonceSha256: string;
  readonly request: CustomerConsentAuthorityInput;
  readonly person: PersonAccountEvidenceReference;
  readonly organisationAuthority: AuthorityRevisionReference;
  readonly channel: ConsentIntentChannel;
  /** Server registry linkage/revision only, never a credential or public-key payload. */
  readonly credential: AuthorityEvidenceReference;
  readonly provenance: AuthorityEvidenceReference;
  readonly verifiedAtMs: number;
}
export interface ConsentVerificationEvidence {
  readonly request: CustomerConsentAuthorityRequest;
  readonly person: VerifiedPersonBinding;
  readonly organisationAuthority: VerifiedOrganisationAuthority;
  readonly challenge: ConsentActionChallenge;
  readonly intent: VerifiedConsentActionIntent;
  /** DECLINE only: read from the scoped, reconstituted E1/E2 Consent, never a command claim. */
  readonly originalGrantor: { readonly personId: string; readonly accountId: string } | null;
}

export const CONSENT_VERIFICATION_POLICY = Symbol('CONSENT_VERIFICATION_POLICY');
export const CONSENT_VERIFICATION_SOURCE = Symbol('CONSENT_VERIFICATION_SOURCE');
export const CONSENT_INTENT_CONSUMPTION = Symbol('CONSENT_INTENT_CONSUMPTION');

export interface ConsentVerificationPolicyPort {
  /** Approved server configuration only; the caller supplies no issuer/policy selector. */
  current(): Promise<ConsentVerificationPolicy | null>;
}
export interface ConsentVerificationSourcePort {
  /**
   * Authenticate issuer/provenance, live person/account linkage and independent
   * Owner authority; resolve the server-issued challenge and verify its enrolled
   * WebAuthn credential, RP/origin, user verification and exact action ceremony.
   * Match the stable transaction, including proposal and source, not merely a
   * login assertion. Enforce approved source freshness/revocation policy.
   * Return null for absent, revoked, stale, conflicting or ambiguous evidence.
   * Throw on unavailable sources. Never trust command evidence or select trust
   * roots from source.authorityId. No raw assertion/credential enters this port.
   * These are independent observations, not an external atomic transaction.
   */
  resolve(input: {
    readonly request: CustomerConsentAuthorityRequest;
    readonly policy: ConsentVerificationPolicy;
  }): Promise<ConsentVerificationEvidence | null>;
}
export interface DurableIntentConsumption {
  readonly consumptionId: string;
  readonly request: CustomerConsentAuthorityRequest;
  readonly policy: ConsentVerificationPolicy;
  readonly evidence: ConsentVerificationEvidence;
}
export interface DurableIntentConsumptionResult {
  readonly outcome: 'CONFIRMED' | 'REJECTED' | 'UNCONFIRMED';
  readonly consumptionId: string;
  readonly verificationAttemptId: string;
  readonly challengeId: string;
}
export interface DurableIntentConsumptionPort {
  /**
   * Future adapter must conditionally consume an ISSUED, unexpired challenge
   * exactly once, with unique challenge/nonce and issuer+intent identity across
   * ALL actions/scopes. Match the whole binding and exact current local policy,
   * person, authority and credential revisions/generations inside the transaction.
   * Append CUSTOMER_CONSENT_INTENT_CONSUMED audit in that same transaction and
   * connection, attributed to request.actorUserId/Organisation, with challenge,
   * consumption, attempt, Consent, Ticket, episode and action reconciliation IDs.
   * No raw proofs or credentials in audit. No business callback replay/retry.
   * Any unknown commit/acknowledgement yields UNCONFIRMED, never a second use.
   * External verification is not atomic with this local transaction; the approved
   * revocation guarantee must address that gap. No adapter is provided in E5A.
   */
  consume(input: DurableIntentConsumption): Promise<DurableIntentConsumptionResult>;
  /** Scoped read-only reconciliation of the original IDs; never reconsume or grant access. */
  reconcile(input: {
    readonly consumptionId: string;
    readonly request: CustomerConsentAuthorityRequest;
    readonly challengeId: string;
  }): Promise<DurableIntentConsumptionResult>;
}
