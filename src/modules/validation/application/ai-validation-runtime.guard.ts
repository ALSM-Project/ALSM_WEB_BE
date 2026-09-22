import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AI_VALIDATOR, AiValidatorMetadata, AiValidatorPort } from '../domain/ai-validator.port';

@Injectable()
export class AiValidationRuntimeGuard {
  constructor(
    private readonly config: ConfigService,
    @Inject(AI_VALIDATOR) private readonly validator: AiValidatorPort,
  ) {}

  assertAvailable(): AiValidatorMetadata {
    if (!this.config.get<boolean>('AI_VALIDATION_ENABLED')) {
      throw new ServiceUnavailableException({
        code: 'VALIDATION_AI_DISABLED',
        message: 'AI validation is disabled',
      });
    }
    if (this.config.get<string>('AI_PROVIDER') !== 'openai') {
      throw new ServiceUnavailableException({
        code: 'VALIDATION_AI_PROVIDER_UNSUPPORTED',
        message: 'A supported AI validation provider is not configured',
      });
    }

    const metadata = this.validator.getMetadata();
    if (metadata.provider !== 'openai') {
      throw new ServiceUnavailableException({
        code: 'VALIDATION_AI_PROVIDER_UNSUPPORTED',
        message: 'A supported AI validation provider is not configured',
      });
    }
    return metadata;
  }
}
