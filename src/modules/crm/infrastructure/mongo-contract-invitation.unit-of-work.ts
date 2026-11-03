import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ClientSession, Connection } from 'mongoose';
import { IdempotentAuditRepository, AUDIT_REPOSITORY } from '../../audit/domain/audit.repository';
import { MongoAuditRepository } from '../../audit/infrastructure/mongo-audit.repository';
import { USER_REPOSITORY, UserRepository } from '../../users/domain/user.repository';
import { MongoUserRepository } from '../../users/infrastructure/mongo-user.repository';
import { MongoTransactionRunner } from '../../../shared/database/mongo-transaction-runner';
import {
  CONTRACT_INVITATION_REPOSITORY,
  ContractInvitationRepository,
} from '../domain/contract-invitation.types';
import {
  ContractInvitationMutationRepositories,
  ContractInvitationUnitOfWork,
} from '../application/contract-invitation-unit-of-work.port';
import { MongoContractInvitationRepository } from './mongo-contract-invitation.repository';

type Transactional<T> = T & {
  inTransaction(session: ClientSession, connection: Connection): T;
};

@Injectable()
export class MongoContractInvitationUnitOfWork implements ContractInvitationUnitOfWork {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @Inject(CONTRACT_INVITATION_REPOSITORY)
    private readonly invitations: ContractInvitationRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(AUDIT_REPOSITORY) private readonly audit: IdempotentAuditRepository,
  ) {}

  run<T>(
    work: (repositories: ContractInvitationMutationRepositories) => Promise<T>,
    resourceId: string,
  ): Promise<T> {
    return new MongoTransactionRunner(this.connection).run(
      (session) => work(this.participants(session)),
      resourceId,
    );
  }

  private participants(session: ClientSession): ContractInvitationMutationRepositories {
    const invitations = (this.invitations as Transactional<ContractInvitationRepository>)
      .inTransaction(session, this.connection);
    const users = (this.users as Transactional<UserRepository>).inTransaction(
      session,
      this.connection,
    );
    const audit = (this.audit as Transactional<IdempotentAuditRepository>).inTransaction(
      session,
      this.connection,
    );
    // Keep the runtime participant checks explicit; all models must share this connection.
    if (!(invitations instanceof MongoContractInvitationRepository) ||
        !(users instanceof MongoUserRepository) || !(audit instanceof MongoAuditRepository)) {
      throw new Error('Unexpected contract invitation transaction participant');
    }
    return { invitations, users, audit };
  }
}
