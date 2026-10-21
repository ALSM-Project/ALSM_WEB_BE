import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditLog, AuditLogSchema } from './infrastructure/audit-log.schema';
import { AUDIT_REPOSITORY } from './domain/audit.repository';
import { MongoAuditRepository } from './infrastructure/mongo-audit.repository';

@Global()
@Module({
  imports: [MongooseModule.forFeature([{ name: AuditLog.name, schema: AuditLogSchema }])],
  providers: [
    MongoAuditRepository,
    { provide: AUDIT_REPOSITORY, useClass: MongoAuditRepository },
  ],
  exports: [AUDIT_REPOSITORY, MongoAuditRepository],
})
export class AuditModule {}
