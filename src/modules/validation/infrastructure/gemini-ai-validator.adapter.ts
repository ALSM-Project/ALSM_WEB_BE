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

const GEMINI_GENERATE_CONTENT_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_CONFIGURED_RETRIES = 5;

interface GeminiCandidate {
  finishReason?: unknown;
  content?: unknown;
}

interface GeminiResponseBody {
  promptFeedback?: unknown;
  candidates?: unknown;
}

interface RetryableFailure {
  error: AiValidatorError;
  retryable: boolean;
}

@Injectable()
export class GeminiAiValidatorAdapter implements AiValidatorPort {
  constructor(private readonly config: ConfigService) {}

  getMetadata(): AiValidatorMetadata {
    return {
      provider: 'gemini',
      model: this.config.getOrThrow<string>('GEMINI_MODEL'),
      promptVersion: this.config.getOrThrow<string>('AI_PROMPT_VERSION'),
    };
  }

  async validate(input: AiValidationInput): Promise<AiValidationResult> {
    const metadata = this.getMetadata();
    const maxFindings = this.config.getOrThrow<number>('AI_MAX_FINDINGS');
    const prompt = buildAiValidationPrompt(input, metadata.promptVersion);
    const response = await this.requestWithRetries(metadata.model, {
      systemInstruction: { parts: [{ text: prompt.instructions }] },
      contents: [{ role: 'user', parts: [{ text: prompt.input }] }],
      generationConfig: {
        candidateCount: 1,
        responseFormat: {
          text: {
            mimeType: 'application/json',
            schema: buildAiValidationJsonSchema(maxFindings),
          },
        },
      },
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

  private async requestWithRetries(model: string, body: Record<string, unknown>): Promise<GeminiResponseBody> {
    const configuredRetries = this.config.getOrThrow<number>('AI_MAX_RETRIES');
    const maxRetries = Math.min(Math.max(configuredRetries, 0), MAX_CONFIGURED_RETRIES);
    let lastFailure: RetryableFailure | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        return await this.requestOnce(model, body);
      } catch (error) {
        const failure = this.classifyFailure(error);
        lastFailure = failure;
        if (!failure.retryable || attempt === maxRetries) throw failure.error;
        await this.delay(Math.min(50 * 2 ** attempt, 500));
      }
    }
    throw lastFailure?.error ?? new AiValidatorError('AI_PROVIDER_UNAVAILABLE', 'AI provider is unavailable');
  }

  private async requestOnce(model: string, body: Record<string, unknown>): Promise<GeminiResponseBody> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.getOrThrow<number>('AI_TIMEOUT_MS'));
    const endpoint = `${GEMINI_GENERATE_CONTENT_ENDPOINT}/${encodeURIComponent(model)}:generateContent`;
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'x-goog-api-key': this.config.getOrThrow<string>('GEMINI_API_KEY'),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) throw this.httpFailure(response.status);
      try {
        return (await response.json()) as GeminiResponseBody;
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

  private extractOutputText(body: GeminiResponseBody): string {
    if (this.isPromptBlocked(body.promptFeedback)) throw this.refused();
    if (!Array.isArray(body.candidates) || body.candidates.length === 0) throw this.invalidResponse();
    const textParts: string[] = [];
    for (const candidateValue of body.candidates) {
      if (typeof candidateValue !== 'object' || candidateValue === null) continue;
      const candidate = candidateValue as GeminiCandidate;
      if (this.isRefusalFinishReason(candidate.finishReason)) throw this.refused();
      if (typeof candidate.content !== 'object' || candidate.content === null) continue;
      const parts = (candidate.content as { parts?: unknown }).parts;
      if (!Array.isArray(parts)) continue;
      for (const partValue of parts) {
        if (typeof partValue === 'object' && partValue !== null) {
          const text = (partValue as { text?: unknown }).text;
          if (typeof text === 'string') textParts.push(text);
        }
      }
    }
    if (textParts.length === 0) throw this.invalidResponse();
    return textParts.join('');
  }

  private isPromptBlocked(value: unknown): boolean {
    if (typeof value !== 'object' || value === null) return false;
    const blockReason = (value as { blockReason?: unknown }).blockReason;
    return typeof blockReason === 'string' && blockReason !== 'BLOCK_REASON_UNSPECIFIED' && blockReason !== 'NONE';
  }

  private isRefusalFinishReason(value: unknown): boolean {
    return value === 'SAFETY' || value === 'BLOCKLIST' || value === 'PROHIBITED_CONTENT';
  }

  private refused(): AiValidatorError {
    return new AiValidatorError('AI_PROVIDER_REFUSED', 'AI provider refused the validation request');
  }

  private httpFailure(status: number): RetryableFailure {
    if (status === 401 || status === 403) {
      return { error: new AiValidatorError('AI_PROVIDER_AUTHENTICATION_FAILED', 'AI provider authentication failed'), retryable: false };
    }
    if (status === 429 || status >= 500) {
      return { error: new AiValidatorError('AI_PROVIDER_UNAVAILABLE', 'AI provider is unavailable'), retryable: true };
    }
    return { error: new AiValidatorError('AI_PROVIDER_REQUEST_REJECTED', 'AI provider rejected the request'), retryable: false };
  }

  private classifyFailure(error: unknown): RetryableFailure {
    if (this.isRetryableFailure(error)) return error;
    if (error instanceof AiValidatorError) {
      return { error, retryable: error.code === 'AI_PROVIDER_TIMEOUT' || error.code === 'AI_PROVIDER_UNAVAILABLE' };
    }
    return { error: new AiValidatorError('AI_PROVIDER_UNAVAILABLE', 'AI provider is unavailable'), retryable: true };
  }

  private isRetryableFailure(error: unknown): error is RetryableFailure {
    return typeof error === 'object' && error !== null && 'error' in error &&
      (error as RetryableFailure).error instanceof AiValidatorError && 'retryable' in error;
  }

  private invalidResponse(): AiValidatorError {
    return new AiValidatorError('AI_PROVIDER_RESPONSE_INVALID', 'AI provider returned an invalid validation response');
  }

  private async delay(milliseconds: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
}
