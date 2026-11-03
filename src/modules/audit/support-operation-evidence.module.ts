import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditLog, AuditLogSchema } from './infrastructure/audit-log.schema';
import { SUPPORT_OPERATION_EVIDENCE } from './domain/support-operation-evidence.port';
import { MongoSupportOperationEvidence } from './infrastructure/mongo-support-operation-evidence';
@Module({
  imports: [MongooseModule.forFeature([{ name: AuditLog.name, schema: AuditLogSchema }])],
  providers: [{ provide: SUPPORT_OPERATION_EVIDENCE, useClass: MongoSupportOperationEvidence }],
  exports: [SUPPORT_OPERATION_EVIDENCE],
})
export class SupportOperationEvidenceModule {}
