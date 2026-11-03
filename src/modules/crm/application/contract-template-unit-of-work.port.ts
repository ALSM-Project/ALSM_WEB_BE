import { IdempotentAuditRepository } from '../../audit/domain/audit.repository';
import { ContractTemplateRepository } from '../domain/contract-template.types';

export interface ContractTemplateMutationRepositories {
  templates: ContractTemplateRepository;
  audit: IdempotentAuditRepository;
}

export interface ContractTemplateUnitOfWork {
  run<T>(work: (repositories: ContractTemplateMutationRepositories) => Promise<T>, resourceId: string): Promise<T>;
}

export const CONTRACT_TEMPLATE_UNIT_OF_WORK = Symbol('CONTRACT_TEMPLATE_UNIT_OF_WORK');
