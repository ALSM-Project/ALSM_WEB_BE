import type {
  AuthorityRevisionReference,
  CustomerConsentReference,
  IndividualSupportBeneficiary,
  PersonAccountEvidenceReference,
  PolicyVersionHashReference,
  TicketConsentScope,
  TicketEpisodeIdentity,
} from './ticket-consent-boundary.contracts';

export type CustomerConsentState =
  | 'NOT_REQUESTED'
  | 'PENDING_VERIFICATION'
  | 'VERIFIED_GRANTED'
  | 'DECLINED'
  | 'WITHDRAWN'
  | 'EXPIRED'
  | 'INVALIDATED'
  | 'SUPERSEDED';
export type CustomerConsentAction =
  'REQUEST' | 'DECLINE' | 'INVALIDATE' | 'GRANT' | 'WITHDRAW' | 'EXPIRE' | 'SUPERSEDE';
export type CustomerConsentInvalidationReason =
  'TICKET_CLOSED' | 'TICKET_CANCELLED' | 'EPISODE_CHANGED';

/** Describes ONLY this proposed individual; it does not verify beneficiary coverage. */
export interface CustomerConsentCoverage {
  readonly kind: 'INDIVIDUAL';
  readonly personId: string;
  readonly accountId: string;
}
export interface CustomerConsentProposal {
  readonly scope: TicketConsentScope;
  readonly beneficiary: IndividualSupportBeneficiary;
  readonly coverage: CustomerConsentCoverage;
  readonly policy: PolicyVersionHashReference;
}
export interface CustomerConsentEvent {
  readonly revision: number;
  readonly from: CustomerConsentState;
  readonly to: CustomerConsentState;
  readonly actorUserId: string;
  readonly source: AuthorityRevisionReference;
  readonly at: Date;
  readonly reason: CustomerConsentInvalidationReason | null;
}
export interface CustomerConsentProps extends TicketEpisodeIdentity, CustomerConsentProposal {
  readonly schemaVersion: 1;
  readonly consentId: string;
  readonly purposeId: string;
  readonly grantor: PersonAccountEvidenceReference;
  readonly customerAuthority: CustomerConsentReference['customerAuthority'];
  readonly requestSource: AuthorityRevisionReference;
  readonly state: CustomerConsentState;
  readonly revision: number;
  readonly createdByUserId: string;
  readonly updatedByUserId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly history: readonly CustomerConsentEvent[];
}

export class CustomerConsentError extends Error {
  constructor(
    readonly code:
      | 'INVALID_CUSTOMER_CONSENT'
      | 'CUSTOMER_CONSENT_INVALID_TRANSITION'
      | 'CUSTOMER_CONSENT_VERIFICATION_UNAVAILABLE'
      | 'CUSTOMER_CONSENT_OPERATION_UNSUPPORTED'
      | 'CUSTOMER_CONSENT_CONTEXT_MISMATCH'
      | 'CUSTOMER_CONSENT_EVENT_REUSED',
  ) {
    super(code);
    this.name = 'CustomerConsentError';
  }
}

export function customerConsentNextState(
  state: CustomerConsentState,
  action: CustomerConsentAction,
): CustomerConsentState {
  if (['DECLINED', 'WITHDRAWN', 'EXPIRED', 'INVALIDATED', 'SUPERSEDED'].includes(state))
    throw new CustomerConsentError('CUSTOMER_CONSENT_INVALID_TRANSITION');
  // No verifier, flag, evidence reference or restored snapshot can open this path.
  if (action === 'GRANT')
    throw new CustomerConsentError('CUSTOMER_CONSENT_VERIFICATION_UNAVAILABLE');
  if (['WITHDRAW', 'EXPIRE', 'SUPERSEDE'].includes(action) || state === 'VERIFIED_GRANTED')
    throw new CustomerConsentError('CUSTOMER_CONSENT_OPERATION_UNSUPPORTED');
  if (state === 'NOT_REQUESTED' && action === 'REQUEST') return 'PENDING_VERIFICATION';
  if (state === 'PENDING_VERIFICATION' && action === 'DECLINE') return 'DECLINED';
  if (state === 'PENDING_VERIFICATION' && action === 'INVALIDATE') return 'INVALIDATED';
  throw new CustomerConsentError('CUSTOMER_CONSENT_INVALID_TRANSITION');
}
