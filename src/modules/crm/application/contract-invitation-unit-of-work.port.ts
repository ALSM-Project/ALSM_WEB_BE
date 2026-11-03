import { IdempotentAuditRepository } from '../../audit/domain/audit.repository';
import { ContractInvitationRepository } from '../domain/contract-invitation.types';
import { UserRepository } from '../../users/domain/user.repository';

export interface ContractInvitationMutationRepositories {
  invitations: ContractInvitationRepository;
  users: Pick<UserRepository, 'create' | 'findByEmail'>;
  audit: IdempotentAuditRepository;
}

export interface ContractInvitationUnitOfWork {
  run<T>(
    work: (repositories: ContractInvitationMutationRepositories) => Promise<T>,
    resourceId: string,
  ): Promise<T>;
}

export const CONTRACT_INVITATION_UNIT_OF_WORK = Symbol('CONTRACT_INVITATION_UNIT_OF_WORK');
