import { AuditRepository } from '../../audit/domain/audit.repository';
import { SupportContextRepository } from '../domain/support-context.repository';

export interface SupportPrincipal {
  userId: string;
  sessionId?: string;
  sessionVersion?: string;
}
export interface SupportClock {
  now(): Date;
}
export const SUPPORT_CLOCK = Symbol('SUPPORT_CLOCK');

export interface SupportContextParticipants {
  contexts: SupportContextRepository;
  audit: AuditRepository;
}
export interface SupportContextUnitOfWork {
  run<T>(resourceId: string, work: (ports: SupportContextParticipants) => Promise<T>): Promise<T>;
}
export const SUPPORT_CONTEXT_UNIT_OF_WORK = Symbol('SUPPORT_CONTEXT_UNIT_OF_WORK');
