import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AI_VALIDATOR, AiValidatorPort } from '../domain/ai-validator.port';
import { FakeAiValidatorAdapter } from './fake-ai-validator.adapter';
import { OpenAiValidatorAdapter } from './openai-ai-validator.adapter';

export function selectAiValidator(
  config: ConfigService,
  fakeAdapter: FakeAiValidatorAdapter,
  openAiAdapter: OpenAiValidatorAdapter,
): AiValidatorPort {
  const enabled = config.get<boolean>('AI_VALIDATION_ENABLED') ?? false;
  const provider = config.get<string>('AI_PROVIDER') ?? 'fake';
  return enabled && provider === 'openai' ? openAiAdapter : fakeAdapter;
}

export const aiValidatorProvider: Provider = {
  provide: AI_VALIDATOR,
  inject: [ConfigService, FakeAiValidatorAdapter, OpenAiValidatorAdapter],
  useFactory: selectAiValidator,
};
