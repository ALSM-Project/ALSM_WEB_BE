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
