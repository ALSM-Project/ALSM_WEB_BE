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

  it('requires the resolved adapter metadata to represent OpenAI', () => {
    validator.getMetadata.mockReturnValue({
      provider: 'fake',
      model: 'none',
      promptVersion: 'none',
    });
    const guard = new AiValidationRuntimeGuard(
      configuration(true, 'openai'),
      validator as unknown as AiValidatorPort,
    );

    expect(() => guard.assertAvailable()).toThrow(
      'A supported AI validation provider is not configured',
    );
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
