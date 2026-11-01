import { Module } from '@nestjs/common';
import { SUPPORT_PROJECT_READER } from './application/support-project-reader.port';
import { MongoSupportProjectReader } from './infrastructure/mongo-support-project-reader';
@Module({
  providers: [{ provide: SUPPORT_PROJECT_READER, useClass: MongoSupportProjectReader }],
  exports: [SUPPORT_PROJECT_READER],
})
export class SupportProjectReaderModule {}
