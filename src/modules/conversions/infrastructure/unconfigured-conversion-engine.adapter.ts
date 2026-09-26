import { Injectable } from '@nestjs/common';
import { ConversionEngineInput, ConversionEngineOutput, ConversionEnginePort } from '../domain/conversion-job.types';

@Injectable()
export class UnconfiguredConversionEngineAdapter implements ConversionEnginePort {
  async execute(input: ConversionEngineInput): Promise<ConversionEngineOutput> {
    return {
      resultReference: `result-${input.conversionJobId}`,
      toolVersion: 'v1.0.0-alsm-conversion-engine',
    };
  }
}
