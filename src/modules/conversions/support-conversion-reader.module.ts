import { Module } from '@nestjs/common';
import { SUPPORT_CONVERSION_READER } from './application/support-conversion-reader.port';
import { MongoSupportConversionReader } from './infrastructure/mongo-support-conversion-reader';
@Module({
  providers: [{ provide: SUPPORT_CONVERSION_READER, useClass: MongoSupportConversionReader }],
  exports: [SUPPORT_CONVERSION_READER],
})
export class SupportConversionReaderModule {}
