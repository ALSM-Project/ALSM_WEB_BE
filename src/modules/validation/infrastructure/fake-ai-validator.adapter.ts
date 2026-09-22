import { Injectable } from '@nestjs/common';
import {
  AiValidationInput,
  AiValidationResult,
  AiValidatorMetadata,
  AiValidatorPort,
} from '../domain/ai-validator.port';

@Injectable()
export class FakeAiValidatorAdapter implements AiValidatorPort {
  getMetadata(): AiValidatorMetadata {
    return { provider: 'fake', model: 'none', promptVersion: 'none' };
  }

  async validate(input: AiValidationInput): Promise<AiValidationResult> {
    void input;
    return { findings: [] };
  }
}
