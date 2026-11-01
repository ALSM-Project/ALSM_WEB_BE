import type { AuditRepository } from '../../audit/domain/audit.repository';
import type { CustomerConsentEntity } from './customer-consent.entity';

export const CUSTOMER_CONSENT_REPOSITORY = Symbol('CUSTOMER_CONSENT_REPOSITORY');
export type CustomerConsentWriteOutcome = 'CONFIRMED' | 'CONFLICT' | 'UNCONFIRMED';
export type CustomerConsentAudit = Parameters<AuditRepository['append']>[0];

/**
 * No adapter exists in E1. A future adapter must confirm state+audit together,
 * enforce insert-only IDs and source-event uniqueness, preserve all immutable
 * bindings/history, and CAS by consent/Ticket/Organisation/episode/revision.
 * Never retry uncertain business work. This contract is NOT persistence evidence
 * or a Ticket/consent/remote-authority revocation transaction.
 */
export interface CustomerConsentRepository {
  findById(
    consentId: string,
    organizationId: string,
    ticketId: string,
  ): Promise<CustomerConsentEntity | null>;
  create(
    consent: CustomerConsentEntity,
    audit: CustomerConsentAudit,
  ): Promise<CustomerConsentWriteOutcome>;
  save(
    consent: CustomerConsentEntity,
    expectedRevision: number,
    audit: CustomerConsentAudit,
  ): Promise<CustomerConsentWriteOutcome>;
}
