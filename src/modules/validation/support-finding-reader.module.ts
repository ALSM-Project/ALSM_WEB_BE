import { Module } from '@nestjs/common';
import { SUPPORT_FINDING_READER } from './application/support-finding-reader.port';
import { MongoSupportFindingReader } from './infrastructure/mongo-support-finding-reader';
@Module({
  providers: [{ provide: SUPPORT_FINDING_READER, useClass: MongoSupportFindingReader }],
  exports: [SUPPORT_FINDING_READER],
})
export class SupportFindingReaderModule {}
