import { environmentValidationSchema } from '../src/config/environment.validation';

describe('AI environment validation', () => {
  const requiredEnvironment = {
    MONGODB_URI: 'mongodb://localhost/alsm',
    REDIS_HOST: 'localhost',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'b'.repeat(32),
    MFA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    CORS_ORIGINS: 'http://localhost:3001',
  };

  it('does not require OpenAI credentials when AI validation is disabled', () => {
    const result = environmentValidationSchema.validate({
      ...requiredEnvironment,
      AI_VALIDATION_ENABLED: false,
      AI_PROVIDER: 'fake',
    });

    expect(result.error).toBeUndefined();
    expect(result.value.OPENAI_API_KEY).toBe('');
    expect(result.value.OPENAI_MODEL).toBe('');
  });

  it('requires OpenAI credentials when OpenAI validation is enabled', () => {
    const result = environmentValidationSchema.validate({
      ...requiredEnvironment,
      AI_VALIDATION_ENABLED: true,
      AI_PROVIDER: 'openai',
      OPENAI_API_KEY: '',
      OPENAI_MODEL: '',
    });

    expect(result.error).toBeDefined();
  });

  it('accepts placeholder-shaped nonempty OpenAI configuration when enabled', () => {
    const result = environmentValidationSchema.validate({
      ...requiredEnvironment,
      AI_VALIDATION_ENABLED: true,
      AI_PROVIDER: 'openai',
      OPENAI_API_KEY: 'synthetic-test-key',
      OPENAI_MODEL: 'test-model',
    });

    expect(result.error).toBeUndefined();
  });
});
