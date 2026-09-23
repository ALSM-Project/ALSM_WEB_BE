import { ConfigService } from '@nestjs/config';
import { FakeAiValidatorAdapter } from '../src/modules/validation/infrastructure/fake-ai-validator.adapter';
import { OpenAiValidatorAdapter } from '../src/modules/validation/infrastructure/openai-ai-validator.adapter';
import { selectAiValidator } from '../src/modules/validation/infrastructure/ai-validator.provider';

describe('AI validator provider selection', () => {
  const fakeAdapter = new FakeAiValidatorAdapter();
  const openAiAdapter = {} as OpenAiValidatorAdapter;

  it('selects the fake adapter whenever AI validation is disabled', () => {
    const config = configuration(false, 'openai');

    expect(selectAiValidator(config, fakeAdapter, openAiAdapter)).toBe(fakeAdapter);
  });

  it('selects OpenAI only when AI validation is enabled and OpenAI is configured', () => {
    const config = configuration(true, 'openai');

    expect(selectAiValidator(config, fakeAdapter, openAiAdapter)).toBe(openAiAdapter);
  });

  it('keeps the fake adapter when explicitly selected', () => {
    const config = configuration(true, 'fake');

    expect(selectAiValidator(config, fakeAdapter, openAiAdapter)).toBe(fakeAdapter);
  });
});

function configuration(enabled: boolean, provider: string): ConfigService {
  const values: Record<string, unknown> = {
    AI_VALIDATION_ENABLED: enabled,
    AI_PROVIDER: provider,
  };
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}
