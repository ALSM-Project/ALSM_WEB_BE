import { ConfigService } from '@nestjs/config';
import { AiValidatorPort } from '../../../src/modules/validation/domain/ai-validator.port';
import { GeminiAiValidatorAdapter } from '../../../src/modules/validation/infrastructure/gemini-ai-validator.adapter';
import { OpenAiValidatorAdapter } from '../../../src/modules/validation/infrastructure/openai-ai-validator.adapter';

export interface LiveValidatorSelection {
  validator: AiValidatorPort;
  config: ConfigService;
}

export function createLiveValidator(environment: NodeJS.ProcessEnv): LiveValidatorSelection {
  const provider = environment.AI_PROVIDER;
  if (provider !== 'openai' && provider !== 'gemini') {
    throw new Error('Live evaluation requires AI_PROVIDER=openai or AI_PROVIDER=gemini');
  }

  const keyName = provider === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY';
  const modelName = provider === 'openai' ? 'OPENAI_MODEL' : 'GEMINI_MODEL';
  const key = requiredEnvironment(environment, keyName);
  const model = requiredEnvironment(environment, modelName);
  const config = new ConfigService({
    OPENAI_API_KEY: provider === 'openai' ? key : '',
    OPENAI_MODEL: provider === 'openai' ? model : '',
    GEMINI_API_KEY: provider === 'gemini' ? key : '',
    GEMINI_MODEL: provider === 'gemini' ? model : '',
    AI_PROMPT_VERSION: environment.AI_PROMPT_VERSION ?? 'semantic-cobol-java-v1',
    AI_TIMEOUT_MS: environmentInteger(environment, 'AI_TIMEOUT_MS', 60_000),
    AI_MAX_RETRIES: environmentInteger(environment, 'AI_MAX_RETRIES', 2),
    AI_MAX_FINDINGS: environmentInteger(environment, 'AI_MAX_FINDINGS', 50),
    AI_MAX_FILES: environmentInteger(environment, 'AI_MAX_FILES', 50),
    AI_MAX_FILE_CHARS: environmentInteger(environment, 'AI_MAX_FILE_CHARS', 200_000),
    AI_MAX_TOTAL_CHARS: environmentInteger(environment, 'AI_MAX_TOTAL_CHARS', 500_000),
  });
  return {
    config,
    validator:
      provider === 'openai'
        ? new OpenAiValidatorAdapter(config)
        : new GeminiAiValidatorAdapter(config),
  };
}

function requiredEnvironment(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name];
  if (!value) throw new Error(`${name} is required for live evaluation`);
  return value;
}

function environmentInteger(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const raw = environment[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0)
    throw new Error(`${name} must be a non-negative integer`);
  return value;
}
