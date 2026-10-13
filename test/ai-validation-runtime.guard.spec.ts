import { ConfigService } from '@nestjs/config';
import { AiValidationRuntimeGuard } from '../src/modules/validation/application/ai-validation-runtime.guard';
import { AiValidatorPort } from '../src/modules/validation/domain/ai-validator.port';

describe('AiValidationRuntimeGuard', () => {
  const validator = { getMetadata: jest.fn() };

  it('rejects disabled execution before consulting the fake adapter', () => {
    const guard = new AiValidationRuntimeGuard(
      configuration(false, 'openai'),
      validator as unknown as AiValidatorPort,
    );

    expect(() => guard.assertAvailable()).toThrow('AI validation is disabled');
    expect(validator.getMetadata).not.toHaveBeenCalled();
  });

  it('rejects an enabled fake or unsupported provider', () => {
    const guard = new AiValidationRuntimeGuard(
      configuration(true, 'fake'),
      validator as unknown as AiValidatorPort,
    );

    expect(() => guard.assertAvailable()).toThrow(
      'A supported AI validation provider is not configured',
    );
    expect(validator.getMetadata).not.toHaveBeenCalled();
  });

  it.each([
    ['openai', 'gemini'],
    ['gemini', 'openai'],
    ['gemini', 'fake'],
  ])('rejects configured %s when resolved metadata reports %s', (configured, resolved) => {
    validator.getMetadata.mockReturnValue({
      provider: resolved,
      model: 'test-model',
      promptVersion: 'semantic-cobol-java-v1',
    });
    const guard = new AiValidationRuntimeGuard(
      configuration(true, configured),
      validator as unknown as AiValidatorPort,
    );

    expect(() => guard.assertAvailable()).toThrow(
      'A supported AI validation provider is not configured',
    );
  });

  it.each(['openai', 'gemini'])('allows matching real provider metadata for %s', (provider) => {
    const metadata = { provider, model: 'test-model', promptVersion: 'semantic-cobol-java-v1' };
    validator.getMetadata.mockReturnValue(metadata);
    const guard = new AiValidationRuntimeGuard(
      configuration(true, provider),
      validator as unknown as AiValidatorPort,
    );
    expect(guard.assertAvailable()).toEqual(metadata);
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
