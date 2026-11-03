import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ClientSession, Connection } from 'mongoose';
import { AUDIT_REPOSITORY, IdempotentAuditRepository } from '../../audit/domain/audit.repository';
import { MongoAuditRepository } from '../../audit/infrastructure/mongo-audit.repository';
import { MongoTransactionRunner } from '../../../shared/database/mongo-transaction-runner';
import { CONTRACT_TEMPLATE_REPOSITORY, ContractTemplateRepository } from '../domain/contract-template.types';
import { ContractTemplateMutationRepositories, ContractTemplateUnitOfWork } from '../application/contract-template-unit-of-work.port';
import { MongoContractTemplateRepository } from './mongo-contract-template.repository';

type Transactional<T> = T & { inTransaction(session: ClientSession, connection: Connection): T };

@Injectable()
export class MongoContractTemplateUnitOfWork implements ContractTemplateUnitOfWork {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @Inject(CONTRACT_TEMPLATE_REPOSITORY) private readonly templates: ContractTemplateRepository,
    @Inject(AUDIT_REPOSITORY) private readonly audit: IdempotentAuditRepository,
  ) {}

  run<T>(work: (repositories: ContractTemplateMutationRepositories) => Promise<T>, resourceId: string): Promise<T> {
    return new MongoTransactionRunner(this.connection).run(
      (session) => {
        const templates = (this.templates as Transactional<ContractTemplateRepository>).inTransaction(session, this.connection);
        const audit = (this.audit as Transactional<IdempotentAuditRepository>).inTransaction(session, this.connection);
        if (!(templates instanceof MongoContractTemplateRepository) || !(audit instanceof MongoAuditRepository)) {
          throw new Error('Unexpected contract template transaction participant');
        }
        return work({ templates, audit });
      },
      resourceId,
    );
  }
}
