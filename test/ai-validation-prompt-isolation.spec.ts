import { ConfigService } from '@nestjs/config';
import { GeminiAiValidatorAdapter } from '../src/modules/validation/infrastructure/gemini-ai-validator.adapter';
import { OpenAiValidatorAdapter } from '../src/modules/validation/infrastructure/openai-ai-validator.adapter';

describe('COBOL provider prompt isolation', () => {
  it.each([GeminiAiValidatorAdapter, OpenAiValidatorAdapter])(
    '%p retains the COBOL prompt when the legacy global setting selects BMS',
    (Adapter) => {
      const config = new ConfigService({
        AI_PROMPT_VERSION: 'semantic-bms-react-v1',
        GEMINI_MODEL: 'synthetic-gemini-model',
        OPENAI_MODEL: 'synthetic-openai-model',
      });
      expect(new Adapter(config).getMetadata().promptVersion).toBe('semantic-cobol-java-v1');
    },
  );
});
