import { Injectable } from '@nestjs/common'; import { ConversionEngineOutput, ConversionEnginePort } from '../domain/conversion-job.types';
/** Deliberately fails until an approved external conversion-tool adapter replaces it. */
@Injectable() export class UnconfiguredConversionEngineAdapter implements ConversionEnginePort { async execute(): Promise<ConversionEngineOutput> { throw new Error('No external ConversionEnginePort adapter has been configured'); } }
