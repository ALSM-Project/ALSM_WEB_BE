import { requireActiveTransaction } from '../../../shared/database/mongo-transaction-runner';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { AuditLog } from './audit-log.schema';
import { AuditRepository } from '../domain/audit.repository';
@Injectable()
export class MongoAuditRepository implements AuditRepository {
  constructor(@InjectModel(AuditLog.name) private readonly model: Model<AuditLog>) {}
  private session?: ClientSession;
  private transaction?: object;
  private assertSession(): void {
    if (this.session) {
      requireActiveTransaction(this.session);
      if (this.transaction !== this.session.transaction)
        throw new Error('Stale transaction participant');
    }
  }
  inTransaction(session: ClientSession, connection: Connection): MongoAuditRepository {
    requireActiveTransaction(session);
    if (this.model.db !== connection) throw new Error('Transaction connection mismatch');
    const repository = new MongoAuditRepository(this.model);
    repository.session = session;
    repository.transaction = session.transaction;
    return repository;
  }
  async append(input: Parameters<AuditRepository['append']>[0]): Promise<void> {
    this.assertSession();
    if (this.session) requireActiveTransaction(this.session);
    await this.model.create(
      [
        {
          ...input,
          actorUserId: input.actorUserId ? new Types.ObjectId(input.actorUserId) : undefined,
          organizationId: input.organizationId
            ? new Types.ObjectId(input.organizationId)
            : undefined,
        },
      ],
      { session: this.session },
    );
  }
}
