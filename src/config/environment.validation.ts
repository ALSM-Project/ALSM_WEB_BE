import * as Joi from 'joi';

export const environmentValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().port().default(3000),
  MONGODB_URI: Joi.string()
    .uri({ scheme: ['mongodb', 'mongodb+srv'] })
    .required(),
  REDIS_HOST: Joi.string().required(),
  REDIS_PORT: Joi.number().port().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').default(''),
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),
  MFA_ENCRYPTION_KEY: Joi.string()
    .custom((value, helpers) => {
      const key = Buffer.from(value, 'base64');
      return key.length === 32 && key.toString('base64') === value
        ? value
        : helpers.error('any.invalid');
    }, 'Base64-encoded 32-byte encryption key')
    .required(),
  MFA_ISSUER: Joi.string().trim().min(1).default('ALSM'),
  CORS_ORIGINS: Joi.string().required(),
  GOOGLE_CLIENT_ID: Joi.string().allow('').default(''),
  CONVERSION_WORKER_ENABLED: Joi.boolean().default(false),
  STORAGE_ROOT: Joi.string().default('./storage'),
  PYTHON_EXECUTABLE: Joi.string().default('python'),
  TOOL_CONVERT_DIR: Joi.string().allow('').default(''),
  CONVERSION_TOOL_TIMEOUT_MS: Joi.number().integer().positive().default(120000),
  JAVA_EXECUTABLE: Joi.string().default('java'),
  TOOL2JAVA_JAR_PATH: Joi.string().allow('').default(''),
  MAX_UPLOAD_FILE_SIZE_MB: Joi.number().integer().positive().default(50),
  MAX_UPLOAD_FILES_PER_REQUEST: Joi.number().integer().positive().default(300),
  CASSO_API_KEY: Joi.string().allow('').default(''),
  SMTP_HOST: Joi.string().allow('').default(''),
  SMTP_PORT: Joi.number().port().default(587),
  SMTP_SECURE: Joi.boolean().default(false),
  SMTP_USER: Joi.string().allow('').default(''),
  SMTP_PASS: Joi.string().allow('').default(''),
  SMTP_FROM: Joi.string().allow('').default(''),
  APP_BASE_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .default('http://localhost:5173'),
  AI_VALIDATION_ENABLED: Joi.boolean().default(false),
  AI_PROVIDER: Joi.string().valid('fake', 'openai').default('fake'),
  OPENAI_API_KEY: Joi.when('AI_VALIDATION_ENABLED', {
    is: true,
    then: Joi.when('AI_PROVIDER', {
      is: 'openai',
      then: Joi.string().min(1).required(),
      otherwise: Joi.string().allow('').default(''),
    }),
    otherwise: Joi.string().allow('').default(''),
  }),
  OPENAI_MODEL: Joi.when('AI_VALIDATION_ENABLED', {
    is: true,
    then: Joi.when('AI_PROVIDER', {
      is: 'openai',
      then: Joi.string().min(1).required(),
      otherwise: Joi.string().allow('').default(''),
    }),
    otherwise: Joi.string().allow('').default(''),
  }),
  AI_TIMEOUT_MS: Joi.number().integer().min(1_000).max(300_000).default(60_000),
  AI_MAX_RETRIES: Joi.number().integer().min(0).max(5).default(2),
  AI_MAX_FILES: Joi.number().integer().min(2).max(500).default(50),
  AI_MAX_FILE_CHARS: Joi.number().integer().min(1).max(2_000_000).default(200_000),
  AI_MAX_TOTAL_CHARS: Joi.number().integer().min(1).max(5_000_000).default(500_000),
  AI_MAX_FINDINGS: Joi.number().integer().min(1).max(200).default(50),
  AI_PROMPT_VERSION: Joi.string().valid('semantic-cobol-java-v1').default('semantic-cobol-java-v1'),
  VALIDATION_WORKER_ENABLED: Joi.boolean().default(false),
  VALIDATION_WORKER_CONCURRENCY: Joi.number().integer().min(1).max(10).default(1),
  VALIDATION_JOB_ATTEMPTS: Joi.number().integer().min(1).max(5).default(2),
  VALIDATION_JOB_BACKOFF_MS: Joi.number().integer().min(0).max(300_000).default(5_000),
});
