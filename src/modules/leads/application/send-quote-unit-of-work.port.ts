import { AuditRepository } from '../../audit/domain/audit.repository';
import { LeadRepository } from '../domain/lead.types';

export interface SendQuoteRepositories {
  leads: LeadRepository;
  audit: AuditRepository;
}

export interface SendQuoteUnitOfWork {
  run<T>(work: (repositories: SendQuoteRepositories) => Promise<T>, resourceId: string): Promise<T>;
}

export const SEND_QUOTE_UNIT_OF_WORK = Symbol('SEND_QUOTE_UNIT_OF_WORK');
