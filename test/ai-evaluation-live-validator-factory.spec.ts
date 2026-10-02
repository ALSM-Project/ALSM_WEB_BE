import { GeminiAiValidatorAdapter } from '../src/modules/validation/infrastructure/gemini-ai-validator.adapter';
import { OpenAiValidatorAdapter } from '../src/modules/validation/infrastructure/openai-ai-validator.adapter';
import { createLiveValidator } from '../evaluation/ai-validation/src/live-validator.factory';

describe('live evaluation validator factory', () => {
  it('creates OpenAI validator without executing it', () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch');
    const { validator } = createLiveValidator({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'test-key', OPENAI_MODEL: 'test-model' });
    expect(validator).toBeInstanceOf(OpenAiValidatorAdapter);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('creates Gemini validator without executing it', () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch');
    const { validator } = createLiveValidator({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'test-key', GEMINI_MODEL: 'test-model' });
    expect(validator).toBeInstanceOf(GeminiAiValidatorAdapter);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([undefined, 'fake', 'other'])('refuses non-real or missing provider %s', (provider) => {
    expect(() => createLiveValidator({ AI_PROVIDER: provider })).toThrow(
      'Live evaluation requires AI_PROVIDER=openai or AI_PROVIDER=gemini',
    );
  });

  it.each([
    [{ AI_PROVIDER: 'openai', OPENAI_MODEL: 'test-model' }, 'OPENAI_API_KEY'],
    [{ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'test-key' }, 'OPENAI_MODEL'],
    [{ AI_PROVIDER: 'gemini', GEMINI_MODEL: 'test-model' }, 'GEMINI_API_KEY'],
    [{ AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'test-key' }, 'GEMINI_MODEL'],
  ])('requires selected provider credentials only', (environment, missing) => {
    expect(() => createLiveValidator(environment)).toThrow(`${missing} is required for live evaluation`);
  });
});
