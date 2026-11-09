import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { withAiResponseMetadata } from '../domain/ai-response-metadata';
import {
  AiValidationInput,
  AiValidationResult,
  AiValidatorMetadata,
  AiValidatorPort,
} from '../domain/ai-validator.port';
import {
  buildAiValidationJsonSchema,
  validateAiValidationOutput,
} from './ai-validation-output.validator';
import {
  buildAiValidationPrompt,
  SEMANTIC_COBOL_JAVA_PROMPT_VERSION,
} from './ai-validation.prompt';
import { createGeminiValidationSchema } from './gemini-validation-schema';
import { GeminiJsonClient } from './gemini-json.client';
@Injectable()
export class GeminiAiValidatorAdapter implements AiValidatorPort {
  constructor(
    private readonly config: ConfigService,
    @Optional() private readonly client: GeminiJsonClient = new GeminiJsonClient(config),
  ) {}
  getMetadata(): AiValidatorMetadata {
    return {
      provider: 'gemini',
      model: this.config.getOrThrow<string>('GEMINI_MODEL'),
      promptVersion: SEMANTIC_COBOL_JAVA_PROMPT_VERSION,
    };
  }
  async validate(input: AiValidationInput): Promise<AiValidationResult> {
    const metadata = this.getMetadata();
    const maxFindings = this.config.getOrThrow<number>('AI_MAX_FINDINGS');
    const prompt = buildAiValidationPrompt(input, metadata.promptVersion);
    const response = await this.client.generateJson(
      metadata.model,
      {
        systemInstruction: { parts: [{ text: prompt.instructions }] },
        contents: [{ role: 'user', parts: [{ text: prompt.input }] }],
        generationConfig: {
          candidateCount: 1,
          responseFormat: {
            text: {
              mimeType: 'APPLICATION_JSON',
              schema: createGeminiValidationSchema(buildAiValidationJsonSchema(maxFindings)),
            },
          },
        },
      },
      (output) => validateAiValidationOutput(output, input, maxFindings),
      (ms) => this.delay(ms),
    );
    return withAiResponseMetadata(
      { findings: response.output },
      metadata.model,
      response.modelVersion,
    );
  }

  // Preserve the existing adapter wait seam and result shape for existing callers.
  private async delay(milliseconds: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
}
