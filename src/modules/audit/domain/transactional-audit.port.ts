import { AuditRepository } from './audit.repository';

/** Opaque infrastructure handles, interpreted only by the database adapters. */
export interface AuditTransaction {
  session: object;
  connection: object;
}
export interface TransactionalAuditFactory {
  bind(transaction: AuditTransaction): AuditRepository;
}
export const TRANSACTIONAL_AUDIT_FACTORY = Symbol('TRANSACTIONAL_AUDIT_FACTORY');
