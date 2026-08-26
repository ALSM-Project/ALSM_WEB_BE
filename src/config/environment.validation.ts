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
  SMTP_HOST: Joi.string().allow('').default(''),
  SMTP_PORT: Joi.number().port().default(587),
  SMTP_SECURE: Joi.boolean().default(false),
  SMTP_USER: Joi.string().allow('').default(''),
  SMTP_PASS: Joi.string().allow('').default(''),
  SMTP_FROM: Joi.string().allow('').default(''),
  APP_BASE_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .default('http://localhost:5173'),
});
