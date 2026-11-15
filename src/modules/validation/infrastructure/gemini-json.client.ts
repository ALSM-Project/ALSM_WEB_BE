import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { withAiResponseMetadata } from '../domain/ai-response-metadata';
import { AiProviderDiagnostics } from '../domain/ai-provider-diagnostics';
import { AiValidatorError } from '../domain/ai-validator.error';
import {
  geminiBackoffMs,
  geminiRateLimitScope,
  GEMINI_RETRY_WAIT_BUDGET_MS,
  retryAfterMs,
} from './gemini-retry-policy';
const GEMINI_GENERATE_CONTENT_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_CONFIGURED_RETRIES = 5;
interface GeminiCandidate {
  finishReason?: unknown;
  content?: unknown;
}
interface GeminiResponseBody {
  modelVersion?: unknown;
  promptFeedback?: unknown;
  candidates?: unknown;
}
interface RetryableFailure {
  rateLimitScope?: AiProviderDiagnostics['rateLimitScope'];
  retryAfterMs?: number;
  error: AiValidatorError;
  retryable: boolean;
  finalFailureClass: AiProviderDiagnostics['finalFailureClass'];
  httpStatus?: number;
}
/** Application-only transport: one retry budget and shared process-local pacing. */
@Injectable()
export class GeminiJsonClient {
  private startQueue: Promise<void> = Promise.resolve();
  private lastStartedAt: number | undefined;
  constructor(private readonly config: ConfigService) {}
  async generateJson<T = unknown>(
    model: string,
    body: Record<string, unknown>,
    validate?: (output: unknown) => T,
    waitForRetry?: (milliseconds: number) => Promise<void>,
  ): Promise<{ output: T; modelVersion?: unknown }> {
    const allowed = (
      this.config.get<string>('GEMINI_ALLOWED_MODELS') ??
      this.config.getOrThrow<string>('GEMINI_MODEL')
    )
      .split(',')
      .map((value) => value.trim());
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(model) || !allowed.includes(model))
      throw new AiValidatorError(
        'AI_PROVIDER_REQUEST_REJECTED',
        'Configured Gemini model is not allowed',
      );
    const startedAt = Date.now();
    const response = await this.requestWithRetries(model, body, startedAt, waitForRetry);
    try {
      const text = this.extractOutputText(response.body);
      let output: unknown;
      try {
        output = JSON.parse(text);
      } catch {
        throw this.invalidResponse();
      }
      return {
        output: validate ? validate(output) : (output as T),
        modelVersion: response.body.modelVersion,
      };
    } catch (error) {
      if (!(error instanceof AiValidatorError)) throw error;
      throw withAiResponseMetadata(
        new AiValidatorError(error.code, error.message, {
          finalFailureClass: error.code === 'AI_PROVIDER_REFUSED' ? 'REFUSED' : 'INVALID_OUTPUT',
          httpStatus: response.httpStatus,
          attempts: response.attempts,
          retriesExhausted: false,
          totalLatencyMs: Math.max(0, Date.now() - startedAt),
        }),
        model,
        response.body?.modelVersion,
      );
    }
  }
  private async requestWithRetries(
    model: string,
    body: Record<string, unknown>,
    startedAt: number,
    waitForRetry?: (milliseconds: number) => Promise<void>,
  ): Promise<{ body: GeminiResponseBody; httpStatus: number; attempts: number }> {
    const configuredRetries = this.config.getOrThrow<number>('AI_MAX_RETRIES');
    const maxRetries = Math.min(Math.max(configuredRetries, 0), MAX_CONFIGURED_RETRIES);
    let lastFailure: RetryableFailure | undefined;
    let retryWaitMs = 0;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        return { ...(await this.pacedRequest(model, body)), attempts: attempt + 1 };
      } catch (error) {
        const failure = this.classifyFailure(error);
        lastFailure = failure;
        const wait = failure.retryAfterMs ?? geminiBackoffMs(attempt);
        if (
          !failure.retryable ||
          attempt === maxRetries ||
          wait > GEMINI_RETRY_WAIT_BUDGET_MS - retryWaitMs
        ) {
          throw new AiValidatorError(failure.error.code, failure.error.message, {
            finalFailureClass: failure.finalFailureClass,
            ...(failure.httpStatus === undefined ? {} : { httpStatus: failure.httpStatus }),
            ...(failure.rateLimitScope === undefined
              ? {}
              : { rateLimitScope: failure.rateLimitScope }),
            attempts: attempt + 1,
            retriesExhausted: failure.retryable && attempt === maxRetries,
            totalLatencyMs: Math.max(0, Date.now() - startedAt),
          });
        }
        retryWaitMs += wait;
        await (waitForRetry ? waitForRetry(wait) : this.delay(wait));
      }
    }
    throw (
      lastFailure?.error ??
      new AiValidatorError('AI_PROVIDER_UNAVAILABLE', 'AI provider is unavailable')
    );
  }

  private async pacedRequest(model: string, body: Record<string, unknown>) {
    const interval = this.config.get<number>('GEMINI_MIN_REQUEST_INTERVAL_MS') ?? 0;
    const endpoint = `${GEMINI_GENERATE_CONTENT_ENDPOINT}/${encodeURIComponent(model)}:generateContent`;
    const init: RequestInit = {
      method: 'POST',
      headers: {
        'x-goog-api-key': this.config.getOrThrow<string>('GEMINI_API_KEY'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    };
    const timeoutMs = this.config.getOrThrow<number>('AI_TIMEOUT_MS');
    if (interval === 0) return this.requestOnce(endpoint, init, timeoutMs, false);
    // Serialize starts, not responses. Record the actual start after waiting, so an
    // event-loop stall cannot collapse reserved future slots into a burst.
    const start = this.startQueue.then(async () => {
      if (this.lastStartedAt !== undefined) {
        let wait = interval - (performance.now() - this.lastStartedAt);
        while (wait > 0) {
          await this.delay(Math.ceil(wait));
          wait = interval - (performance.now() - this.lastStartedAt);
        }
      }
      return { response: this.requestOnce(endpoint, init, timeoutMs, true) };
    });
    this.startQueue = start.then(
      () => undefined,
      () => undefined,
    );
    return (await start).response;
  }

  private async requestOnce(
    endpoint: string,
    init: RequestInit,
    timeoutMs: number,
    paced: boolean,
  ): Promise<{ body: GeminiResponseBody; httpStatus: number }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    init.signal = controller.signal;
    let httpStatus: number | undefined;
    let knownRetryAfterMs: number | undefined;
    let rateLimitScope: AiProviderDiagnostics['rateLimitScope'];
    try {
      // Preparation is complete: no await or serialization between timestamp and fetch.
      if (paced) this.lastStartedAt = performance.now();
      const response = await fetch(endpoint, init);
      httpStatus = response.status;
      if (!response.ok) {
        const failure = this.httpFailure(response.status);
        if (failure.retryable)
          knownRetryAfterMs = retryAfterMs(
            response.headers?.get('Retry-After') ?? null,
            Date.now(),
          );
        failure.retryAfterMs = knownRetryAfterMs;
        if (response.status === 429) {
          rateLimitScope = 'UNKNOWN';
          try {
            rateLimitScope = geminiRateLimitScope(await response.json());
          } catch {
            // Keep safe transport metadata even if the body is unreadable or aborted.
          }
          failure.rateLimitScope = rateLimitScope;
          if (failure.rateLimitScope === 'DAILY_QUOTA') {
            failure.retryable = false;
            failure.error = new AiValidatorError(
              'AI_PROVIDER_DAILY_QUOTA_EXCEEDED',
              'Gemini daily quota is exhausted; wait for the quota reset before requesting validation',
            );
          }
        }
        throw failure;
      }
      try {
        return { body: (await response.json()) as GeminiResponseBody, httpStatus: response.status };
      } catch {
        throw {
          error: this.invalidResponse(),
          retryable: false,
          finalFailureClass: 'INVALID_OUTPUT',
          httpStatus: response.status,
        } satisfies RetryableFailure;
      }
    } catch (error) {
      if (controller.signal.aborted) {
        throw {
          error: new AiValidatorError('AI_PROVIDER_TIMEOUT', 'AI provider request timed out'),
          retryable: true,
          finalFailureClass: 'TIMEOUT',
          ...(httpStatus === undefined ? {} : { httpStatus }),
          ...(knownRetryAfterMs === undefined ? {} : { retryAfterMs: knownRetryAfterMs }),
          ...(rateLimitScope === undefined ? {} : { rateLimitScope }),
        } satisfies RetryableFailure;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private extractOutputText(body: GeminiResponseBody): string {
    if (typeof body !== 'object' || body === null || Array.isArray(body))
      throw this.invalidResponse();
    if (this.isPromptBlocked(body.promptFeedback)) throw this.refused();
    if (!Array.isArray(body.candidates) || body.candidates.length === 0)
      throw this.invalidResponse();
    const textParts: string[] = [];
    for (const candidateValue of body.candidates) {
      if (typeof candidateValue !== 'object' || candidateValue === null) continue;
      const candidate = candidateValue as GeminiCandidate;
      if (this.isRefusalFinishReason(candidate.finishReason)) throw this.refused();
      if (candidate.finishReason !== undefined && candidate.finishReason !== 'STOP')
        throw this.invalidResponse();
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
    return (
      typeof blockReason === 'string' &&
      blockReason !== 'BLOCK_REASON_UNSPECIFIED' &&
      blockReason !== 'NONE'
    );
  }

  private isRefusalFinishReason(value: unknown): boolean {
    return value === 'SAFETY' || value === 'BLOCKLIST' || value === 'PROHIBITED_CONTENT';
  }

  private refused(): AiValidatorError {
    return new AiValidatorError(
      'AI_PROVIDER_REFUSED',
      'AI provider refused the validation request',
    );
  }

  private httpFailure(status: number): RetryableFailure {
    if (status === 401 || status === 403) {
      return {
        error: new AiValidatorError(
          'AI_PROVIDER_AUTHENTICATION_FAILED',
          'AI provider authentication failed',
        ),
        retryable: false,
        finalFailureClass: 'AUTHENTICATION_FAILED',
        httpStatus: status,
      };
    }
    if (status === 429 || status >= 500) {
      return {
        error: new AiValidatorError('AI_PROVIDER_UNAVAILABLE', 'AI provider is unavailable'),
        retryable: true,
        finalFailureClass: status === 429 ? 'RATE_LIMITED' : 'SERVER_ERROR',
        httpStatus: status,
      };
    }
    return {
      error: new AiValidatorError(
        'AI_PROVIDER_REQUEST_REJECTED',
        'AI provider rejected the request',
      ),
      retryable: false,
      finalFailureClass: 'REQUEST_REJECTED',
      httpStatus: status,
    };
  }

  private classifyFailure(error: unknown): RetryableFailure {
    if (this.isRetryableFailure(error)) return error;
    if (error instanceof AiValidatorError) {
      return {
        error,
        retryable: error.code === 'AI_PROVIDER_TIMEOUT' || error.code === 'AI_PROVIDER_UNAVAILABLE',
        finalFailureClass:
          error.code === 'AI_PROVIDER_TIMEOUT'
            ? 'TIMEOUT'
            : error.code === 'AI_PROVIDER_RESPONSE_INVALID'
              ? 'INVALID_OUTPUT'
              : 'NETWORK_ERROR',
      };
    }
    return {
      error: new AiValidatorError('AI_PROVIDER_UNAVAILABLE', 'AI provider is unavailable'),
      retryable: true,
      finalFailureClass: 'NETWORK_ERROR',
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
