import { Injectable } from '@nestjs/common';
import { ConversionType } from '../../projects/domain/project.types';
import {
  ConversionEngineInput,
  ConversionEngineOutput,
  ConversionEnginePort,
} from '../domain/conversion-job.types';
import { BmsDspfConversionAdapter } from './bms-dspf-conversion.adapter';
import { CobolJavaConversionAdapter } from './cobol-java-conversion.adapter';

/** Selects the real adapter for a job's conversionType. This is the single seam between the worker and the two external tools — no tool-specific logic lives outside the adapters it delegates to. */
@Injectable()
export class ConversionEngineRouter implements ConversionEnginePort {
  constructor(
    private readonly bmsDspfAdapter: BmsDspfConversionAdapter,
    private readonly cobolJavaAdapter: CobolJavaConversionAdapter,
  ) {}

  async execute(input: ConversionEngineInput): Promise<ConversionEngineOutput> {
    switch (input.conversionType) {
      case ConversionType.BMS_DSPF_TO_FRONTEND:
        return this.bmsDspfAdapter.execute(input);
      case ConversionType.COBOL_TO_JAVA:
        return this.cobolJavaAdapter.execute(input);
      default:
        throw new Error(`No conversion adapter configured for conversionType: ${String(input.conversionType)}`);
    }
  }
}
