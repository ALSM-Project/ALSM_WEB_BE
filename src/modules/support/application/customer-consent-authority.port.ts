import type {
  AuthorityRevisionReference,
  CustomerConsentReference,
  PersonAccountEvidenceReference,
  TicketConsentScope,
  TicketEpisodeIdentity,
} from '../domain/ticket-consent-boundary.contracts';
import type {
  CustomerConsentInvalidationReason,
  CustomerConsentProposal,
} from '../domain/customer-consent.types';

export const CUSTOMER_CONSENT_AUTHORITY = Symbol('CUSTOMER_CONSENT_AUTHORITY');
export interface CustomerConsentAuthorityRequest {
  /** Server-created correlation for this invocation only; not an identity/intent proof or credential. */
  readonly verificationAttemptId: string;
  readonly action: 'REQUEST' | 'STATUS' | 'DECLINE' | 'INVALIDATE';
  readonly actorUserId: string;
  readonly ticket: TicketEpisodeIdentity;
  readonly ticketRevision: number;
  readonly consentId: string;
  readonly expectedConsentRevision: number | null;
  readonly scope: TicketConsentScope;
  readonly proposal: CustomerConsentProposal | null;
  readonly source: AuthorityRevisionReference | null;
  readonly invalidationReason: CustomerConsentInvalidationReason | null;
}
/** Application input cannot select the authority invocation's correlation. */
export type CustomerConsentAuthorityInput = Omit<
  CustomerConsentAuthorityRequest,
  'verificationAttemptId'
>;
export interface CustomerConsentActorAuthorization {
  readonly request: CustomerConsentAuthorityRequest;
  readonly actor: PersonAccountEvidenceReference;
  readonly customerAuthority: CustomerConsentReference['customerAuthority'];
}
/**
 * No production adapter/default grant in E1. A later reviewed adapter must reuse
 * existing current Owner verification and authenticate person/account linkage,
 * exact action/source intent and authority provenance independently of claims.
 * Request/negative-action authorization is never a verified positive consent.
 * An interface or CURRENT reference is not evidence that this trust exists.
 *
 * Verification boundary for a future reviewed provider:
 * - Resolve the actor's person/account linkage and Owner provenance from
 *   authoritative records, never proposal/source fields, JWT role/person claims,
 *   Ticket creation, a checkbox, or a client-selected authorityId.
 * - Authenticate genuine intent for this exact actor, Organisation, Ticket,
 *   episode, purpose/full scope, action, Consent identity/revisions and proposal.
 * - Determine freshness/revocation using an approved source policy; CURRENT is
 *   not a substitute. No default TTL or assurance policy is defined here.
 * - Atomically verify/consume action evidence against durable replay state.
 *   A new attempt ID must not make consumed source intent reusable. Duplicate,
 *   stale, conflicting or ambiguous evidence returns null; source/consumption
 *   unavailability or unknown outcomes throw, without automatic retry.
 * - Return the exact request, including verificationAttemptId, only for this
 *   invocation. Correlation prevents response reuse, not fresh source replay.
 * - DECLINE also requires the original persisted grantor account AND person;
 *   E1 checks that equality after scoped snapshot reconstitution. This request
 *   carries no caller-asserted original grantor. STATUS has no source claim and
 *   still requires independent scoped authority, never a cached mutation proof.
 *
 * No implementation, source allowlist, trusted identity integration, consumption
 * store or freshness policy is supplied by this interface. E4 remains blocked
 * for production wiring until those mechanisms are approved and implemented.
 */
export interface CustomerConsentAuthorityPort {
  authorize(
    request: CustomerConsentAuthorityRequest,
  ): Promise<CustomerConsentActorAuthorization | null>;
}
