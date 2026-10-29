import { ClientSession, Connection } from 'mongoose';
import { AuditRepository } from '../../audit/domain/audit.repository';
import { MongoTransactionRunner } from '../../../shared/database/mongo-transaction-runner';
import { SendQuoteRepositories, SendQuoteUnitOfWork } from '../application/send-quote-unit-of-work.port';
import { MongoLeadRepository } from './mongo-lead.repository';

export class MongoSendQuoteUnitOfWork implements SendQuoteUnitOfWork {
  constructor(
    private readonly connection: Connection,
    private readonly leads: MongoLeadRepository,
    private readonly audit: (session: ClientSession, connection: Connection) => AuditRepository,
  ) {}

  run<T>(work: (repositories: SendQuoteRepositories) => Promise<T>, resourceId: string): Promise<T> {
    return new MongoTransactionRunner(this.connection).run(
      (session) => work({
        leads: this.leads.inTransaction(session, this.connection),
        audit: this.audit(session, this.connection),
      }),
      resourceId,
    );
  }
}
