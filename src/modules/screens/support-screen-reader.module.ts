import { Module } from '@nestjs/common';
import { SUPPORT_SCREEN_READER } from './application/support-screen-reader.port';
import { MongoSupportScreenReader } from './infrastructure/mongo-support-screen-reader';
@Module({
  providers: [{ provide: SUPPORT_SCREEN_READER, useClass: MongoSupportScreenReader }],
  exports: [SUPPORT_SCREEN_READER],
})
export class SupportScreenReaderModule {}
