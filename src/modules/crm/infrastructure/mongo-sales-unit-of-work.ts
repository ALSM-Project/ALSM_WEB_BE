import { ClientSession, Connection } from 'mongoose';
import { AuditRepository } from '../../audit/domain/audit.repository';
import { SalesRevenueRepository } from '../../billing/domain/sales-revenue.port';
import { MongoTransactionRunner } from '../../../shared/database/mongo-transaction-runner';
import { SalesMutationRepositories, SalesUnitOfWork } from '../application/sales-unit-of-work.port';
import { MongoLeadRepository } from './mongo-lead.repository';
export class MongoSalesUnitOfWork implements SalesUnitOfWork {
  constructor(
    private readonly connection: Connection,
    private readonly leads: MongoLeadRepository,
    private readonly revenue: (
      session: ClientSession,
      connection: Connection,
    ) => SalesRevenueRepository,
    private readonly audit: (session: ClientSession, connection: Connection) => AuditRepository,
  ) {}
  run<T>(
    work: (repositories: SalesMutationRepositories) => Promise<T>,
    resourceId: string,
  ): Promise<T> {
    return new MongoTransactionRunner(this.connection).run(
      (session) =>
        work({
          leads: this.leads.inTransaction(session, this.connection),
          revenue: this.revenue(session, this.connection),
          audit: this.audit(session, this.connection),
        }),
      resourceId,
    );
  }
}
