/**
 * S1 TC A: non-operational reference contracts for review only.
 * Every reference is an unverified claim until independently authenticated by a
 * trusted authority. Types, matching IDs, hashes and CURRENT status confer no trust.
 * No trusted providers, policy adoption, access grants or customer data live here.
 */
export type AuthorityReferenceStatus =
  'CURRENT' | 'STALE' | 'REVOKED' | 'EXPIRED' | 'INVALIDATED' | 'SUPERSEDED' | 'UNKNOWN';

/** Opaque retained revisions/generations; no default, ordering or time arithmetic. */
export interface AuthorityRevisionReference {
  readonly authorityId: string;
  readonly evidenceId: string;
  readonly revision: string;
  readonly generation: string;
}

export interface AuthorityEvidenceReference extends AuthorityRevisionReference {
  readonly status: AuthorityReferenceStatus;
}

/** References required for future trusted person/account equivalence verification. */
export interface PersonAccountEvidenceReference {
  readonly personId: string;
  readonly accountId: string;
  readonly provenance: AuthorityEvidenceReference;
}

export interface TicketEpisodeIdentity {
  readonly ticketId: string;
  readonly organizationId: string;
  readonly episodeId: string;
}

export interface FirstPartyTicketReference {
  readonly source: 'ALSM_FIRST_PARTY_TICKET';
  readonly identity: TicketEpisodeIdentity;
  readonly evidence: AuthorityEvidenceReference;
  readonly status: 'OPEN' | 'CLOSED' | 'CANCELLED' | 'UNKNOWN';
}

export interface IndividualSupportBeneficiary {
  readonly identity: PersonAccountEvidenceReference;
  /** Evidence reference only; never an ordinary session credential. */
  readonly ordinarySession: AuthorityEvidenceReference;
  readonly entitlement: AuthorityEvidenceReference;
}

/** Operation descriptions, including explicit forbidden cases; no API allowlist. */
export type TicketConsentOperation =
  | 'UC66_READ_PROJECTS'
  | 'UC66_READ_SCREENS'
  | 'UC66_READ_PROGRAMS'
  | 'UC66_READ_LOGS'
  | 'CUSTOMER_BUSINESS_MUTATION'
  | 'UC67_MAPPING_CHANGE'
  | 'UC67_RETRY_CONVERSION';

export interface TicketConsentScope {
  readonly useCase: 'UC66' | 'UC67';
  readonly purposeId: string;
  readonly operation: TicketConsentOperation;
  readonly projectionId: string;
  readonly environmentId: string;
  readonly mode: 'READ_ONLY' | 'CUSTOMER_WRITE';
}

/** A hash or decision reference does not demonstrate formal policy approval. */
export interface PolicyVersionHashReference {
  readonly policyId: string;
  readonly version: string;
  readonly sha256: string;
  readonly decisionEvidence: AuthorityEvidenceReference;
}

export interface TicketConsentBinding {
  readonly ticket: TicketEpisodeIdentity;
  readonly requester: PersonAccountEvidenceReference;
  readonly beneficiary: IndividualSupportBeneficiary;
  readonly scope: TicketConsentScope;
  readonly policy: PolicyVersionHashReference;
  readonly authorityGeneration: string;
  readonly customerConsent: AuthorityRevisionReference;
  readonly internalApproval: AuthorityRevisionReference;
}

export interface CustomerConsentReference {
  readonly kind: 'CUSTOMER_CONSENT';
  readonly reference: AuthorityEvidenceReference;
  readonly binding: TicketConsentBinding;
  readonly grantor: PersonAccountEvidenceReference;
  readonly customerAuthority: {
    readonly kind: 'ORGANIZATION_OWNER' | 'AUTHORIZED_REPRESENTATIVE';
    readonly organizationId: string;
    readonly evidence: AuthorityEvidenceReference;
  };
}

export interface IndependentInternalApprovalReference {
  readonly kind: 'INTERNAL_APPROVAL';
  readonly reference: AuthorityEvidenceReference;
  readonly binding: TicketConsentBinding;
  readonly approver: PersonAccountEvidenceReference;
  readonly approverAuthority: AuthorityEvidenceReference;
  readonly customerConsent: AuthorityRevisionReference;
}

export interface TicketConsentBoundaryInput {
  readonly binding: TicketConsentBinding;
  readonly ticket: FirstPartyTicketReference;
  readonly customerConsent: CustomerConsentReference | null;
  readonly internalApproval: IndependentInternalApprovalReference | null;
}

export type TicketConsentDenialReason =
  | 'MALFORMED_INPUT'
  | 'MISSING_CUSTOMER_CONSENT'
  | 'MISSING_INTERNAL_APPROVAL'
  | 'DISTINCT_DECISIONS_REQUIRED'
  | 'TICKET_SCOPE_MISMATCH'
  | 'TERMINAL_OR_UNKNOWN_TICKET'
  | 'REQUESTER_APPROVER_SAME_PERSON'
  | 'BENEFICIARY_MISMATCH'
  | 'POLICY_MISMATCH'
  | 'BINDING_MISMATCH'
  | 'REFERENCE_MISMATCH'
  | 'STALE_REFERENCE'
  | 'TERMINAL_OR_UNKNOWN_REFERENCE'
  | 'FORBIDDEN_OPERATION'
  | 'EVIDENCE_NOT_INDEPENDENTLY_VERIFIED';

/** Intentionally no allow variant, credential, grant or echoed input evidence. */
export interface TicketConsentBoundaryDenial {
  readonly outcome: 'DENY';
  readonly operationalAccess: false;
  readonly reason: TicketConsentDenialReason;
}
