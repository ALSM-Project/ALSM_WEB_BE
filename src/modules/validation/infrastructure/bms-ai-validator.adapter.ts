import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BMS_VALIDATION_JSON_SCHEMA,
  BmsValidationCategory,
  BmsValidationFinding,
} from '../domain/bms-validation-taxonomy';
import { buildBmsAiValidationPrompt } from './bms-ai-validation.prompt';
import { ValidationFindingSeverity } from '../domain/validation-finding.types';
import { AiValidationInput } from '../domain/ai-validator.port';
import { AiValidatorError } from '../domain/ai-validator.error';
import { validateBmsAiValidationOutput } from './bms-ai-validation-output.validator';

export type BmsAiValidationInput = AiValidationInput;

export interface BmsAiValidationResult {
  provider: string;
  model: string;
  promptVersion: string;
  findings: BmsValidationFinding[];
  durationMs: number;
}

/**
 * BƯỚC 6: Tích Hợp Hệ Thống & Cơ Chế Phòng Thủ (Defensive Integration)
 * - Adapter Pattern (Clean Architecture): Cách ly logic gọi LLM
 * - Timeout: AbortController ngắt kết nối sau timeout cấu hình (AI_TIMEOUT_MS)
 * - Graceful Degradation: Bắt lỗi mạng / API quota sập -> ghi log và trả về [] an toàn
 * - Deduplication: Loại bỏ các phát hiện trùng lặp
 */
@Injectable()
export class BmsAiValidatorAdapter {
  private readonly logger = new Logger(BmsAiValidatorAdapter.name);

  constructor(private readonly config: ConfigService) {}

  async validate(input: BmsAiValidationInput): Promise<BmsAiValidationResult> {
    const startTime = Date.now();
    const rawEnabled = this.config.get('AI_VALIDATION_ENABLED');
    const enabled = rawEnabled === true || rawEnabled === 'true';
    const provider = this.config.get<string>('AI_PROVIDER') || 'fake';
    const model =
      this.config.get<string>('GEMINI_MODEL') ||
      this.config.get<string>('OPENAI_MODEL') ||
      'gemini-3.8-flash';
    const timeoutMs = this.config.get<number>('AI_TIMEOUT_MS') || 90000;

    // 1. Nếu tắt AI Validation -> Trả về danh sách rỗng ngay lập tức
    if (!enabled || provider === 'fake') {
      this.logger.log('BMS AI Validator is disabled or using fake provider.');
      return {
        provider: 'fake',
        model: 'heuristic-rules',
        promptVersion: 'semantic-bms-react-v1',
        findings: this.runHeuristicChecks(input),
        durationMs: Date.now() - startTime,
      };
    }

    // 2. Tiền xử lý & Khử PII (chỉ lấy code TSX/JSX, bỏ file JSON metadata)
    // Input is already selected, redacted and numbered by the shared gateway.
    const asPromptFile = (file: AiValidationInput['sourceFiles'][number]) => ({
      path: file.path,
      lineCount: file.lineCount,
      sanitizedContent: file.content,
      numberedContent: file.content,
    });
    const sanitizedSources = input.sourceFiles.map(asPromptFile);
    const sanitizedTargets = input.targetFiles.map(asPromptFile);

    const { systemPrompt, userPrompt } = buildBmsAiValidationPrompt(
      sanitizedSources,
      sanitizedTargets,
    );

    // 3. Cơ chế phòng thủ: Timeout với AbortController
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    try {
      let output: unknown;

      if (provider === 'gemini') {
        this.logger.log(
          `Calling Gemini API (${model})... SystemPrompt: ${systemPrompt.length} chars, UserPrompt: ${userPrompt.length} chars.`,
        );
        output = await this.callGemini(systemPrompt, userPrompt, controller.signal);
      } else if (provider === 'openai') {
        output = await this.callOpenAi(systemPrompt, userPrompt, controller.signal);
      } else {
        throw new AiValidatorError('AI_PROVIDER_REQUEST_REJECTED', 'AI provider is unsupported');
      }

      const rawFindings = validateBmsAiValidationOutput(
        output,
        input,
        this.config.getOrThrow<number>('AI_MAX_FINDINGS'),
      );

      // 4. Khử trùng lặp (Deduplication)
      const deduplicated = this.deduplicateFindings(rawFindings);

      return {
        provider,
        model,
        promptVersion: 'semantic-bms-react-v1',
        findings: deduplicated,
        durationMs: Date.now() - startTime,
      };
    } catch (error: unknown) {
      const code = error instanceof AiValidatorError ? error.code : 'AI_PROVIDER_UNAVAILABLE';
      this.logger.warn(`BMS AI Validation failed (${code}); using heuristic validation.`);
      return {
        provider: 'heuristic-fallback',
        model: 'heuristic-rules-v1',
        promptVersion: 'semantic-bms-react-v1',
        findings: this.runHeuristicChecks(input),
        durationMs: Date.now() - startTime,
      };
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  /**
   * Gọi Google Gemini API với JSON Schema ép buộc và cơ chế tự động thử lại (Retry)
   */
  private async callGemini(
    systemPrompt: string,
    userPrompt: string,
    signal: AbortSignal,
  ): Promise<unknown> {
    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    const configuredModel = this.config.get<string>('GEMINI_MODEL') || 'gemini-3.8-flash';
    if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');

    const candidateModels = [
      ...new Set([configuredModel, 'gemini-3.7-flash', 'gemini-flash-latest']),
    ];
    let lastError: Error | null = null;

    for (const model of candidateModels) {
      if (signal.aborted) throw new Error('Gemini API call timed out');
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

      for (let attempt = 1; attempt <= 2; attempt++) {
        if (signal.aborted) throw new Error('Gemini API call timed out');

        try {
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            signal,
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: systemPrompt }] },
              contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
              generationConfig: {
                responseMimeType: 'application/json',
                responseSchema: BMS_VALIDATION_JSON_SCHEMA,
                temperature: 0.0,
              },
            }),
          });

          if (!response.ok) {
            const isRateOrDemand = response.status === 503 || response.status === 429;
            if (isRateOrDemand) {
              this.logger.warn(
                `Gemini model ${model} returned ${response.status} (High demand/quota spike, attempt ${attempt}/2).`,
              );
              if (attempt < 2) {
                await new Promise((resolve) => setTimeout(resolve, 1500));
                continue;
              }
              lastError = new AiValidatorError(
                'AI_PROVIDER_UNAVAILABLE',
                'AI provider is unavailable',
              );
              break;
            }
            throw new AiValidatorError(
              'AI_PROVIDER_REQUEST_REJECTED',
              'AI provider rejected the request',
            );
          }

          const data = await response.json();
          if (
            data?.promptFeedback?.blockReason ||
            ['SAFETY', 'BLOCKLIST', 'PROHIBITED_CONTENT'].includes(
              data?.candidates?.[0]?.finishReason,
            )
          ) {
            throw new AiValidatorError(
              'AI_PROVIDER_REFUSED',
              'AI provider refused the validation request',
            );
          }
          const candidateText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (typeof candidateText !== 'string') throw this.invalidResponse();

          return this.parseOutput(candidateText);
        } catch (err: unknown) {
          if (err instanceof AiValidatorError && err.code !== 'AI_PROVIDER_UNAVAILABLE') throw err;
          lastError = err instanceof Error ? err : new Error(String(err));
          if (signal.aborted) throw err;
          if (attempt >= 2) break;
        }
      }
    }

    throw lastError || new Error('All Gemini candidate models failed due to high demand');
  }

  /**
   * Gọi OpenAI API với JSON mode
   */
  private async callOpenAi(
    systemPrompt: string,
    userPrompt: string,
    signal: AbortSignal,
  ): Promise<unknown> {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    const model = this.config.get<string>('OPENAI_MODEL') || 'gpt-4o-mini';
    if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      signal,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.0,
      }),
    });

    if (!response.ok) {
      throw new AiValidatorError(
        response.status === 429 || response.status >= 500
          ? 'AI_PROVIDER_UNAVAILABLE'
          : 'AI_PROVIDER_REQUEST_REJECTED',
        'AI provider request failed',
      );
    }

    const data = await response.json();
    if (data?.choices?.[0]?.message?.refusal) {
      throw new AiValidatorError(
        'AI_PROVIDER_REFUSED',
        'AI provider refused the validation request',
      );
    }
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw this.invalidResponse();

    return this.parseOutput(content);
  }

  private parseOutput(content: string): unknown {
    try {
      return JSON.parse(content);
    } catch {
      throw this.invalidResponse();
    }
  }

  private invalidResponse(): AiValidatorError {
    return new AiValidatorError(
      'AI_PROVIDER_RESPONSE_INVALID',
      'AI provider returned an invalid validation response',
    );
  }

  /**
   * Quy tắc Heuristic dự phòng khi AI offline
   */
  private runHeuristicChecks(input: BmsAiValidationInput): BmsValidationFinding[] {
    const findings: BmsValidationFinding[] = [];
    const source = input.sourceFiles[0]?.content || '';
    const target = input.targetFiles[0]?.content || '';

    // Check 1: Thuộc tính NUM nhưng React thiếu numeric
    if (source.includes('ATTRB=(UNPROT,NUM)') && !target.includes('inputMode="numeric"')) {
      findings.push({
        category: BmsValidationCategory.ATTRIBUTE_MISMATCH,
        severity: ValidationFindingSeverity.MEDIUM,
        fieldName: 'NUMERIC_INPUT',
        sourceLocation: {
          file: input.sourceFiles[0]?.path || 'source.bms',
          startLine: 1,
          endLine: 1,
        },
        targetLocation: {
          file: input.targetFiles[0]?.path || 'target.tsx',
          startLine: 1,
          endLine: 1,
        },
        explanation:
          'BMS specifies numeric attribute (NUM) but React component does not declare inputMode="numeric".',
        suggestion: 'Add inputMode="numeric" to the relevant <input /> element.',
      });
    }

    return findings;
  }

  /**
   * Khử các lỗi trùng lặp (Deduplication)
   */
  private deduplicateFindings(findings: BmsValidationFinding[]): BmsValidationFinding[] {
    const seen = new Set<string>();
    return findings.filter((f) => {
      const key = JSON.stringify([
        f.category,
        f.fieldName.toUpperCase(),
        f.sourceLocation,
        f.targetLocation,
      ]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}
