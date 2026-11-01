import type {
  DurableIntentConsumption,
  DurableIntentConsumptionResult,
} from './consent-verification-foundation.port';

/** E5B is an isolated synthetic ledger, not a source of verified Customer Consent. */
export type SyntheticConsentIntentRegistration = Omit<DurableIntentConsumption, 'consumptionId'>;
export type ConsentIntentWriteOutcome = 'CONFIRMED' | 'CONFLICT' | 'UNCONFIRMED';
export interface ConsentIntentReconciliation extends DurableIntentConsumptionResult {
  readonly status:
    | 'COMMITTED'
    | 'ALREADY_CONSUMED'
    | 'ABSENT_UNCERTAIN'
    | 'EVIDENCE_INCONSISTENT'
    | 'EVIDENCE_UNAVAILABLE';
  readonly operationalAccess: false;
}
/**
 * Diagnostic only. COMMITTED requires the exact original receipt, consumed
 * challenge and matching audit in one snapshot. An absent receipt is never proof
 * of an aborted/failed commit. No status authorizes a retry or Support access.
 */
export interface SyntheticConsentIntentRegistrationPort {
  registerSynthetic(input: SyntheticConsentIntentRegistration): Promise<ConsentIntentWriteOutcome>;
}
