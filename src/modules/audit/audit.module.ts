import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditLog, AuditLogSchema } from './infrastructure/audit-log.schema';
import { AUDIT_REPOSITORY } from './domain/audit.repository';
import { MongoAuditRepository } from './infrastructure/mongo-audit.repository';
import { TRANSACTIONAL_AUDIT_FACTORY } from './domain/transactional-audit.port';
import { MongoTransactionalAuditFactory } from './infrastructure/mongo-transactional-audit.factory';

@Global()
@Module({
  imports: [MongooseModule.forFeature([{ name: AuditLog.name, schema: AuditLogSchema }])],
  providers: [
    { provide: TRANSACTIONAL_AUDIT_FACTORY, useClass: MongoTransactionalAuditFactory },
    MongoAuditRepository,
    { provide: AUDIT_REPOSITORY, useClass: MongoAuditRepository },
  ],
  exports: [AUDIT_REPOSITORY, MongoAuditRepository, TRANSACTIONAL_AUDIT_FACTORY],
})
export class AuditModule {}
