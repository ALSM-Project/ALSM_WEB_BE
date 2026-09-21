import { Injectable } from '@nestjs/common';
import {
  AiValidationInput,
  AiValidationResult,
  AiValidatorPort,
} from '../domain/ai-validator.port';

@Injectable()
export class FakeAiValidatorAdapter implements AiValidatorPort {
  async validate(input: AiValidationInput): Promise<AiValidationResult> {
    void input;
    return { findings: [] };
  }
}
