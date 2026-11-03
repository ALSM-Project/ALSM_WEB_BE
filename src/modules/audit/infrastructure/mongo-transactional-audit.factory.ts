import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model } from 'mongoose';
import { AuditTransaction, TransactionalAuditFactory } from '../domain/transactional-audit.port';
import { AuditLog } from './audit-log.schema';
import { MongoAuditRepository } from './mongo-audit.repository';

@Injectable()
export class MongoTransactionalAuditFactory implements TransactionalAuditFactory {
  constructor(@InjectModel(AuditLog.name) private readonly model: Model<AuditLog>) {}

  bind(transaction: AuditTransaction): MongoAuditRepository {
    return new MongoAuditRepository(this.model).inTransaction(
      transaction.session as ClientSession,
      transaction.connection as Connection,
    );
  }
}
