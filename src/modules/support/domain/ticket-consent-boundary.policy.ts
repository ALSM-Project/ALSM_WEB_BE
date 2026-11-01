import type {
  AuthorityEvidenceReference,
  AuthorityRevisionReference,
  CustomerConsentReference,
  FirstPartyTicketReference,
  IndependentInternalApprovalReference,
  IndividualSupportBeneficiary,
  PersonAccountEvidenceReference,
  PolicyVersionHashReference,
  TicketConsentBinding,
  TicketConsentBoundaryDenial,
  TicketConsentBoundaryInput,
  TicketConsentDenialReason,
  TicketConsentScope,
  TicketEpisodeIdentity,
} from './ticket-consent-boundary.contracts';

type Check = (value: unknown) => boolean;
type FieldChecks<T> = { [K in keyof T]-?: Check };

const identifier: Check = (value) => typeof value === 'string' && /^[^\s\p{Cc}]+$/u.test(value);
const oneOf =
  (...values: readonly string[]): Check =>
  (value) =>
    typeof value === 'string' && values.includes(value);

function isDataRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Exact own data fields only: no inherited claims, accessors or extra flags. */
function hasShape<T>(value: unknown, checks: FieldChecks<T>): value is T {
  if (!isDataRecord(value)) return false;
  const keys = Reflect.ownKeys(value);
  const fields = Object.keys(checks) as (keyof T & string)[];
  if (keys.length !== fields.length) return false;
  return fields.every((field) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    return descriptor !== undefined && 'value' in descriptor && checks[field](descriptor.value);
  });
}

const revisionFields: FieldChecks<AuthorityRevisionReference> = {
  authorityId: identifier,
  evidenceId: identifier,
  revision: identifier,
  generation: identifier,
};
const isRevision = (value: unknown): value is AuthorityRevisionReference =>
  hasShape<AuthorityRevisionReference>(value, revisionFields);
const isEvidence = (value: unknown): value is AuthorityEvidenceReference =>
  hasShape<AuthorityEvidenceReference>(value, {
    ...revisionFields,
    status: oneOf('CURRENT', 'STALE', 'REVOKED', 'EXPIRED', 'INVALIDATED', 'SUPERSEDED', 'UNKNOWN'),
  });
const isPerson = (value: unknown): value is PersonAccountEvidenceReference =>
  hasShape<PersonAccountEvidenceReference>(value, {
    personId: identifier,
    accountId: identifier,
    provenance: isEvidence,
  });
const isTicketIdentity = (value: unknown): value is TicketEpisodeIdentity =>
  hasShape<TicketEpisodeIdentity>(value, {
    ticketId: identifier,
    organizationId: identifier,
    episodeId: identifier,
  });
const isTicket = (value: unknown): value is FirstPartyTicketReference =>
  hasShape<FirstPartyTicketReference>(value, {
    source: oneOf('ALSM_FIRST_PARTY_TICKET'),
    identity: isTicketIdentity,
    evidence: isEvidence,
    status: oneOf('OPEN', 'CLOSED', 'CANCELLED', 'UNKNOWN'),
  });
const isBeneficiary = (value: unknown): value is IndividualSupportBeneficiary =>
  hasShape<IndividualSupportBeneficiary>(value, {
    identity: isPerson,
    ordinarySession: isEvidence,
    entitlement: isEvidence,
  });
const isScope = (value: unknown): value is TicketConsentScope =>
  hasShape<TicketConsentScope>(value, {
    useCase: oneOf('UC66', 'UC67'),
    purposeId: identifier,
    operation: oneOf(
      'UC66_READ_PROJECTS',
      'UC66_READ_SCREENS',
      'UC66_READ_PROGRAMS',
      'UC66_READ_LOGS',
      'CUSTOMER_BUSINESS_MUTATION',
      'UC67_MAPPING_CHANGE',
      'UC67_RETRY_CONVERSION',
    ),
    projectionId: identifier,
    environmentId: identifier,
    mode: oneOf('READ_ONLY', 'CUSTOMER_WRITE'),
  });
const isPolicy = (value: unknown): value is PolicyVersionHashReference =>
  hasShape<PolicyVersionHashReference>(value, {
    policyId: identifier,
    version: identifier,
    sha256: (hash) => typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash),
    decisionEvidence: isEvidence,
  });
const isBinding = (value: unknown): value is TicketConsentBinding =>
  hasShape<TicketConsentBinding>(value, {
    ticket: isTicketIdentity,
    requester: isPerson,
    beneficiary: isBeneficiary,
    scope: isScope,
    policy: isPolicy,
    authorityGeneration: identifier,
    customerConsent: isRevision,
    internalApproval: isRevision,
  });
const isConsent = (value: unknown): value is CustomerConsentReference =>
  hasShape<CustomerConsentReference>(value, {
    kind: oneOf('CUSTOMER_CONSENT'),
    reference: isEvidence,
    binding: isBinding,
    grantor: isPerson,
    customerAuthority: (authority) =>
      hasShape<CustomerConsentReference['customerAuthority']>(authority, {
        kind: oneOf('ORGANIZATION_OWNER', 'AUTHORIZED_REPRESENTATIVE'),
        organizationId: identifier,
        evidence: isEvidence,
      }),
  });
const isApproval = (value: unknown): value is IndependentInternalApprovalReference =>
  hasShape<IndependentInternalApprovalReference>(value, {
    kind: oneOf('INTERNAL_APPROVAL'),
    reference: isEvidence,
    binding: isBinding,
    approver: isPerson,
    approverAuthority: isEvidence,
    customerConsent: isRevision,
  });
const isInput = (value: unknown): value is TicketConsentBoundaryInput =>
  hasShape<TicketConsentBoundaryInput>(value, {
    binding: isBinding,
    ticket: isTicket,
    customerConsent: (consent) => consent === null || isConsent(consent),
    internalApproval: (approval) => approval === null || isApproval(approval),
  });

/** Recheck own data descriptors: shape checks cannot stabilize hostile objects. */
function sameData(left: unknown, right: unknown, ancestors = new Set<object>()): boolean {
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') {
    return left === right;
  }
  if (!isDataRecord(left) || !isDataRecord(right)) return false;
  if (ancestors.has(left) || ancestors.has(right)) return false;
  ancestors.add(left);
  ancestors.add(right);
  try {
    const keys = Reflect.ownKeys(left);
    if (keys.length !== Reflect.ownKeys(right).length) return false;
    return keys.every((key) => {
      const leftDescriptor = Object.getOwnPropertyDescriptor(left, key);
      const rightDescriptor = Object.getOwnPropertyDescriptor(right, key);
      return (
        leftDescriptor !== undefined &&
        rightDescriptor !== undefined &&
        'value' in leftDescriptor &&
        'value' in rightDescriptor &&
        sameData(leftDescriptor.value, rightDescriptor.value, ancestors)
      );
    });
  } finally {
    ancestors.delete(left);
    ancestors.delete(right);
  }
}

function sameRevision(
  left: AuthorityRevisionReference,
  right: AuthorityRevisionReference,
): boolean {
  return (
    left.authorityId === right.authorityId &&
    left.evidenceId === right.evidenceId &&
    left.revision === right.revision &&
    left.generation === right.generation
  );
}

function bindingEvidence(binding: TicketConsentBinding): readonly AuthorityEvidenceReference[] {
  return [
    binding.requester.provenance,
    binding.beneficiary.identity.provenance,
    binding.beneficiary.ordinarySession,
    binding.beneficiary.entitlement,
    binding.policy.decisionEvidence,
  ];
}

function forbiddenScope(scope: TicketConsentScope): boolean {
  return (
    scope.useCase !== 'UC66' ||
    scope.mode !== 'READ_ONLY' ||
    scope.operation === 'CUSTOMER_BUSINESS_MUTATION' ||
    scope.operation === 'UC67_MAPPING_CHANGE' ||
    scope.operation === 'UC67_RETRY_CONVERSION'
  );
}

function deny(reason: TicketConsentDenialReason): TicketConsentBoundaryDenial {
  return Object.freeze({ outcome: 'DENY', operationalAccess: false, reason });
}

/**
 * Pure, deterministic, denial-only S1 boundary. Checks describe inconsistencies
 * in claimed references; they do not authenticate people, policy or decisions.
 * Trusted verification providers are absent, so even consistent inputs deny.
 * No clocks, providers, credentials, persistence or application entry points.
 */
export function validateTicketConsentBoundary(input: unknown): TicketConsentBoundaryDenial {
  try {
    if (!isInput(input)) return deny('MALFORMED_INPUT');
    const { binding, ticket, customerConsent: consent, internalApproval: approval } = input;
    if (consent === null) return deny('MISSING_CUSTOMER_CONSENT');
    if (approval === null) return deny('MISSING_INTERNAL_APPROVAL');

    const bindings = [binding, consent.binding, approval.binding];
    if (bindings.some((candidate) => forbiddenScope(candidate.scope))) {
      return deny('FORBIDDEN_OPERATION');
    }
    if (ticket.status !== 'OPEN') return deny('TERMINAL_OR_UNKNOWN_TICKET');
    if (
      bindings.some((candidate) => !sameData(candidate.ticket, ticket.identity)) ||
      consent.customerAuthority.organizationId !== ticket.identity.organizationId
    ) {
      return deny('TICKET_SCOPE_MISMATCH');
    }
    if (
      consent.reference.authorityId === approval.reference.authorityId &&
      consent.reference.evidenceId === approval.reference.evidenceId
    ) {
      return deny('DISTINCT_DECISIONS_REQUIRED');
    }
    if (binding.requester.personId === approval.approver.personId) {
      return deny('REQUESTER_APPROVER_SAME_PERSON');
    }
    if (
      !sameData(binding.requester, binding.beneficiary.identity) ||
      bindings.some((candidate) => !sameData(candidate.beneficiary, binding.beneficiary))
    ) {
      return deny('BENEFICIARY_MISMATCH');
    }
    if (bindings.some((candidate) => !sameData(candidate.policy, binding.policy))) {
      return deny('POLICY_MISMATCH');
    }
    if (
      !sameRevision(binding.customerConsent, consent.reference) ||
      !sameRevision(binding.internalApproval, approval.reference) ||
      !sameRevision(approval.customerConsent, consent.reference)
    ) {
      return deny('REFERENCE_MISMATCH');
    }
    if (bindings.some((candidate) => !sameData(candidate, binding))) {
      return deny('BINDING_MISMATCH');
    }

    const references = [
      ...bindings.flatMap(bindingEvidence),
      ticket.evidence,
      consent.reference,
      consent.grantor.provenance,
      consent.customerAuthority.evidence,
      approval.reference,
      approval.approver.provenance,
      approval.approverAuthority,
    ];
    if (references.some((reference) => reference.status === 'STALE')) {
      return deny('STALE_REFERENCE');
    }
    if (references.some((reference) => reference.status !== 'CURRENT')) {
      return deny('TERMINAL_OR_UNKNOWN_REFERENCE');
    }

    // There is deliberately no provider/flag/override path to an allow result.
    // Coherent references, including unknown issuer/policy/generation claims,
    // remain unauthenticated and cannot establish current operational authority.
    return deny('EVIDENCE_NOT_INDEPENDENTLY_VERIFIED');
  } catch {
    // Malformed objects (including throwing proxies) never escape as a success
    // or expose the input/exception in a denial outcome.
    return deny('MALFORMED_INPUT');
  }
}
