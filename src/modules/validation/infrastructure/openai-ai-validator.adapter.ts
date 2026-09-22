import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiValidatorError } from '../domain/ai-validator.error';
import {
  AiValidationInput,
  AiValidationResult,
  AiValidatorMetadata,
  AiValidatorPort,
} from '../domain/ai-validator.port';
import { buildAiValidationJsonSchema, validateAiValidationOutput } from './ai-validation-output.validator';
import { buildAiValidationPrompt } from './ai-validation.prompt';

const OPENAI_RESPONSES_ENDPOINT = 'https://api.openai.com/v1/responses';
const MAX_CONFIGURED_RETRIES = 5;

interface OpenAiResponseContent {
  type?: unknown;
  text?: unknown;
  refusal?: unknown;
}

interface OpenAiResponseItem {
  type?: unknown;
  content?: unknown;
}

interface OpenAiResponseBody {
  status?: unknown;
  output?: unknown;
}

interface RetryableFailure {
  error: AiValidatorError;
  retryable: boolean;
}

@Injectable()
export class OpenAiValidatorAdapter implements AiValidatorPort {
  constructor(private readonly config: ConfigService) {}

  getMetadata(): AiValidatorMetadata {
    return {
      provider: 'openai',
      model: this.config.getOrThrow<string>('OPENAI_MODEL'),
      promptVersion: this.config.getOrThrow<string>('AI_PROMPT_VERSION'),
    };
  }

  async validate(input: AiValidationInput): Promise<AiValidationResult> {
    const metadata = this.getMetadata();
    const maxFindings = this.config.getOrThrow<number>('AI_MAX_FINDINGS');
    const prompt = buildAiValidationPrompt(input, metadata.promptVersion);
    const response = await this.requestWithRetries({
      model: metadata.model,
      instructions: prompt.instructions,
      input: prompt.input,
      text: {
        format: {
          type: 'json_schema',
          name: 'alsm_semantic_validation_findings',
          strict: true,
          schema: buildAiValidationJsonSchema(maxFindings),
        },
      },
      store: false,
      tools: [],
      tool_choice: 'none',
      truncation: 'disabled',
    });
    const outputText = this.extractOutputText(response);

    let parsed: unknown;
    try {
      parsed = JSON.parse(outputText);
    } catch {
      throw this.invalidResponse();
    }

    return { findings: validateAiValidationOutput(parsed, input, maxFindings) };
  }

  private async requestWithRetries(body: Record<string, unknown>): Promise<OpenAiResponseBody> {
    const configuredRetries = this.config.getOrThrow<number>('AI_MAX_RETRIES');
    const maxRetries = Math.min(Math.max(configuredRetries, 0), MAX_CONFIGURED_RETRIES);
    let lastFailure: RetryableFailure | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        return await this.requestOnce(body);
      } catch (error) {
        const failure = this.classifyFailure(error);
        lastFailure = failure;
        if (!failure.retryable || attempt === maxRetries) throw failure.error;
        await this.delay(Math.min(50 * 2 ** attempt, 500));
      }
    }

    throw lastFailure?.error ?? new AiValidatorError('AI_PROVIDER_UNAVAILABLE', 'AI provider is unavailable');
  }

  private async requestOnce(body: Record<string, unknown>): Promise<OpenAiResponseBody> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.getOrThrow<number>('AI_TIMEOUT_MS'),
    );

    try {
      const response = await fetch(OPENAI_RESPONSES_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.getOrThrow<string>('OPENAI_API_KEY')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) throw this.httpFailure(response.status);

      try {
        return (await response.json()) as OpenAiResponseBody;
      } catch {
        throw this.invalidResponse();
      }
    } catch (error) {
      if (controller.signal.aborted) {
        throw new AiValidatorError('AI_PROVIDER_TIMEOUT', 'AI provider request timed out');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private extractOutputText(body: OpenAiResponseBody): string {
    if (body.status !== 'completed' || !Array.isArray(body.output)) {
      throw this.invalidResponse();
    }

    const textParts: string[] = [];
    for (const itemValue of body.output) {
      const item = itemValue as OpenAiResponseItem;
      if (item.type !== 'message' || !Array.isArray(item.content)) continue;
      for (const contentValue of item.content) {
        const content = contentValue as OpenAiResponseContent;
        if (content.type === 'refusal' || typeof content.refusal === 'string') {
          throw new AiValidatorError('AI_PROVIDER_REFUSED', 'AI provider refused the validation request');
        }
        if (content.type === 'output_text' && typeof content.text === 'string') {
          textParts.push(content.text);
        }
      }
    }

    if (textParts.length === 0) throw this.invalidResponse();
    return textParts.join('');
  }

  private httpFailure(status: number): RetryableFailure {
    if (status === 401 || status === 403) {
      return {
        error: new AiValidatorError(
          'AI_PROVIDER_AUTHENTICATION_FAILED',
          'AI provider authentication failed',
        ),
        retryable: false,
      };
    }
    if (status === 429 || status >= 500) {
      return {
        error: new AiValidatorError('AI_PROVIDER_UNAVAILABLE', 'AI provider is unavailable'),
        retryable: true,
      };
    }
    return {
      error: new AiValidatorError('AI_PROVIDER_REQUEST_REJECTED', 'AI provider rejected the request'),
      retryable: false,
    };
  }

  private classifyFailure(error: unknown): RetryableFailure {
    if (this.isRetryableFailure(error)) return error;
    if (error instanceof AiValidatorError) {
      return {
        error,
        retryable: error.code === 'AI_PROVIDER_TIMEOUT' || error.code === 'AI_PROVIDER_UNAVAILABLE',
      };
    }
    return {
      error: new AiValidatorError('AI_PROVIDER_UNAVAILABLE', 'AI provider is unavailable'),
      retryable: true,
    };
  }

  private isRetryableFailure(error: unknown): error is RetryableFailure {
    return (
      typeof error === 'object' &&
      error !== null &&
      'error' in error &&
      (error as RetryableFailure).error instanceof AiValidatorError &&
      'retryable' in error
    );
  }

  private invalidResponse(): AiValidatorError {
    return new AiValidatorError(
      'AI_PROVIDER_RESPONSE_INVALID',
      'AI provider returned an invalid validation response',
    );
  }

  private async delay(milliseconds: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
}
