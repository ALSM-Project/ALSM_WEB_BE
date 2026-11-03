import { IdempotentAuditRepository } from '../../audit/domain/audit.repository';
import { ContractAggregateRepository } from '../domain/contract-aggregate.types';
import { ContractNotificationEmailOutboxRepository } from '../domain/contract-notification-email-outbox.types';

export interface ContractNotificationInput {
  recipientUserIds: string[];
  type: string;
  title: string;
  message: string;
  eventKey: string;
  resourceType?: string;
  resourceId?: string;
  link?: string;
}

export interface ContractNotificationRepository {
  create(input: ContractNotificationInput): Promise<number>;
}

export interface ContractAggregateMutationRepositories {
  contracts: ContractAggregateRepository;
  audit: IdempotentAuditRepository;
  notifications: ContractNotificationRepository;
  emailOutbox: ContractNotificationEmailOutboxRepository;
}

export interface ContractAggregateUnitOfWork {
  run<T>(work: (repositories: ContractAggregateMutationRepositories) => Promise<T>, resourceId: string): Promise<T>;
}

export const CONTRACT_AGGREGATE_UNIT_OF_WORK = Symbol('CONTRACT_AGGREGATE_UNIT_OF_WORK');
