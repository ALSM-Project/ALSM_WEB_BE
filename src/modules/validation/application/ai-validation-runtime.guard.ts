import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AI_VALIDATOR,
  BMS_AI_VALIDATOR,
  AiValidatorMetadata,
  AiValidatorPort,
} from '../domain/ai-validator.port';
import { ConversionType } from '../../projects/domain/project.types';

@Injectable()
export class AiValidationRuntimeGuard {
  constructor(
    private readonly config: ConfigService,
    @Inject(AI_VALIDATOR) private readonly validator: AiValidatorPort,
    @Inject(BMS_AI_VALIDATOR) private readonly bmsValidator: AiValidatorPort,
  ) {}

  assertAvailable(conversionType = ConversionType.COBOL_TO_JAVA): AiValidatorMetadata {
    if (!this.config.get<boolean>('AI_VALIDATION_ENABLED')) {
      throw new ServiceUnavailableException({
        code: 'VALIDATION_AI_DISABLED',
        message: 'AI validation is disabled',
      });
    }
    const provider = this.config.get<string>('AI_PROVIDER');
    if (provider !== 'openai' && provider !== 'gemini') {
      throw new ServiceUnavailableException({
        code: 'VALIDATION_AI_PROVIDER_UNSUPPORTED',
        message: 'A supported AI validation provider is not configured',
      });
    }

    const metadata = (
      conversionType === ConversionType.BMS_DSPF_TO_FRONTEND ? this.bmsValidator : this.validator
    ).getMetadata();
    if (metadata.provider !== provider) {
      throw new ServiceUnavailableException({
        code: 'VALIDATION_AI_PROVIDER_UNSUPPORTED',
        message: 'A supported AI validation provider is not configured',
      });
    }
    return metadata;
  }
}
