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
    expect(result.value.GEMINI_API_KEY).toBe('');
    expect(result.value.GEMINI_MODEL).toBe('');
  });

  it.each([
    [{ GEMINI_API_KEY: 'synthetic-key', GEMINI_MODEL: 'test-model' }, false],
    [{ GEMINI_API_KEY: '', GEMINI_MODEL: 'test-model' }, true],
    [{ GEMINI_API_KEY: 'synthetic-key', GEMINI_MODEL: '' }, true],
  ])('conditionally validates enabled Gemini configuration', (gemini, invalid) => {
    const result = environmentValidationSchema.validate({
      ...requiredEnvironment, AI_VALIDATION_ENABLED: true, AI_PROVIDER: 'gemini', ...gemini,
    });
    expect(Boolean(result.error)).toBe(invalid);
    if (!invalid) {
      expect(result.value.OPENAI_API_KEY).toBe('');
      expect(result.value.OPENAI_MODEL).toBe('');
    }
  });

  it('requires both selected OpenAI credentials independently', () => {
    for (const values of [
      { OPENAI_API_KEY: '', OPENAI_MODEL: 'test-model' },
      { OPENAI_API_KEY: 'synthetic-key', OPENAI_MODEL: '' },
    ]) {
      expect(environmentValidationSchema.validate({
        ...requiredEnvironment, AI_VALIDATION_ENABLED: true, AI_PROVIDER: 'openai', ...values,
      }).error).toBeDefined();
    }
  });

  it('rejects unsupported providers and accepts disabled real-provider config without credentials', () => {
    expect(environmentValidationSchema.validate({
      ...requiredEnvironment, AI_VALIDATION_ENABLED: true, AI_PROVIDER: 'other',
    }).error).toBeDefined();
    expect(environmentValidationSchema.validate({
      ...requiredEnvironment, AI_VALIDATION_ENABLED: false, AI_PROVIDER: 'gemini',
    }).error).toBeUndefined();
  });

  it('applies bounded validation queue defaults without requiring the worker', () => {
    const result = environmentValidationSchema.validate(requiredEnvironment);

    expect(result.error).toBeUndefined();
    expect(result.value).toEqual(
      expect.objectContaining({
        VALIDATION_WORKER_ENABLED: false,
        VALIDATION_WORKER_CONCURRENCY: 1,
        VALIDATION_JOB_ATTEMPTS: 2,
        VALIDATION_JOB_BACKOFF_MS: 5_000,
      }),
    );
  });

  it.each([
    ['VALIDATION_WORKER_CONCURRENCY', 0],
    ['VALIDATION_JOB_ATTEMPTS', 0],
    ['VALIDATION_JOB_ATTEMPTS', 6],
    ['VALIDATION_JOB_BACKOFF_MS', -1],
  ])('rejects an unsafe %s value', (key, value) => {
    const result = environmentValidationSchema.validate({
      ...requiredEnvironment,
      [key]: value,
    });

    expect(result.error).toBeDefined();
  });
});
