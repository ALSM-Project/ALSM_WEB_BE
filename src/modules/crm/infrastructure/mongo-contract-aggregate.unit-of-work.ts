import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ClientSession, Connection } from 'mongoose';
import { AUDIT_REPOSITORY, IdempotentAuditRepository } from '../../audit/domain/audit.repository';
import { MongoAuditRepository } from '../../audit/infrastructure/mongo-audit.repository';
import { MongoTransactionRunner } from '../../../shared/database/mongo-transaction-runner';
import { CONTRACT_AGGREGATE_REPOSITORY, ContractAggregateRepository } from '../domain/contract-aggregate.types';
import { ContractAggregateMutationRepositories, ContractAggregateUnitOfWork } from '../application/contract-aggregate-unit-of-work.port';
import { MongoContractAggregateRepository } from './mongo-contract-aggregate.repository';
import { NotificationsService } from '../../notifications/notifications.service';
import {
  CONTRACT_NOTIFICATION_EMAIL_OUTBOX_REPOSITORY,
  ContractNotificationEmailOutboxRepository,
} from '../domain/contract-notification-email-outbox.types';

type Transactional<T> = T & { inTransaction(session: ClientSession, connection: Connection): T };

@Injectable()
export class MongoContractAggregateUnitOfWork implements ContractAggregateUnitOfWork {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @Inject(CONTRACT_AGGREGATE_REPOSITORY) private readonly contracts: ContractAggregateRepository,
    @Inject(AUDIT_REPOSITORY) private readonly audit: IdempotentAuditRepository,
    @Inject(CONTRACT_NOTIFICATION_EMAIL_OUTBOX_REPOSITORY) private readonly emailOutbox: ContractNotificationEmailOutboxRepository,
    private readonly notifications: NotificationsService,
  ) {}

  run<T>(work: (repositories: ContractAggregateMutationRepositories) => Promise<T>, resourceId: string): Promise<T> {
    return new MongoTransactionRunner(this.connection).run(
      (session) => work(this.participants(session)),
      resourceId,
    );
  }

  private participants(session: ClientSession): ContractAggregateMutationRepositories {
    const contracts = (this.contracts as Transactional<ContractAggregateRepository>).inTransaction(session, this.connection);
    const audit = (this.audit as Transactional<IdempotentAuditRepository>).inTransaction(session, this.connection);
    if (!(contracts instanceof MongoContractAggregateRepository) || !(audit instanceof MongoAuditRepository)) {
      throw new Error('Unexpected contract aggregate transaction participant');
    }
    return {
      contracts,
      audit,
      notifications: {
        create: (input) => this.notifications.createForUsers(input, session),
      },
      emailOutbox: {
        enqueue: (input) => this.emailOutbox.enqueue(input, session),
        claimNext: (input) => this.emailOutbox.claimNext(input),
        settle: (input) => this.emailOutbox.settle(input, session),
      },
    };
  }
}
