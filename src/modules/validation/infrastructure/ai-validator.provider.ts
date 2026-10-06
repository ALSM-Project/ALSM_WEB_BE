import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AI_VALIDATOR, AiValidatorPort } from '../domain/ai-validator.port';
import { FakeAiValidatorAdapter } from './fake-ai-validator.adapter';
import { OpenAiValidatorAdapter } from './openai-ai-validator.adapter';
import { GeminiAiValidatorAdapter } from './gemini-ai-validator.adapter';

export function selectAiValidator(
  config: ConfigService,
  fakeAdapter: FakeAiValidatorAdapter,
  openAiAdapter: OpenAiValidatorAdapter,
  geminiAdapter: GeminiAiValidatorAdapter,
): AiValidatorPort {
  const enabled = config.get<boolean>('AI_VALIDATION_ENABLED') ?? false;
  const provider = config.get<string>('AI_PROVIDER') ?? 'fake';
  if (!enabled) return fakeAdapter;
  if (provider === 'openai') return openAiAdapter;
  if (provider === 'gemini') return geminiAdapter;
  return fakeAdapter;
}

export const aiValidatorProvider: Provider = {
  provide: AI_VALIDATOR,
  inject: [ConfigService, FakeAiValidatorAdapter, OpenAiValidatorAdapter, GeminiAiValidatorAdapter],
  useFactory: selectAiValidator,
};
