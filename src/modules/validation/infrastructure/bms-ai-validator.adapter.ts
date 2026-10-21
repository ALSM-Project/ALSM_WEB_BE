import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BmsSanitizerService } from '../application/bms-sanitizer.service';
import {
  BMS_VALIDATION_JSON_SCHEMA,
  BmsValidationCategory,
  BmsValidationFinding,
} from '../domain/bms-validation-taxonomy';
import { buildBmsAiValidationPrompt } from './bms-ai-validation.prompt';
import { ValidationFindingSeverity } from '../domain/validation-finding.types';
import { AiValidatorError } from '../domain/ai-validator.error';

export interface BmsAiValidationInput {
  conversionJobId: string;
  sourceFiles: { path: string; content: string }[];
  targetFiles: { path: string; content: string }[];
}

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

  constructor(
    private readonly config: ConfigService,
    private readonly sanitizer: BmsSanitizerService,
  ) {}

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
    const sanitizedSources = input.sourceFiles.map((f) =>
      this.sanitizer.process(f.path, f.content),
    );
    const sanitizedTargets = input.targetFiles
      .filter((f) => !f.path.toLowerCase().endsWith('.json'))
      .map((f) => this.sanitizer.process(f.path, f.content));

    const { systemPrompt, userPrompt } = buildBmsAiValidationPrompt(
      sanitizedSources,
      sanitizedTargets,
    );

    // 3. Cơ chế phòng thủ: Timeout với AbortController
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    try {
      let rawFindings: BmsValidationFinding[] = [];

      if (provider === 'gemini') {
        this.logger.log(
          `Calling Gemini API (${model})... SystemPrompt: ${systemPrompt.length} chars, UserPrompt: ${userPrompt.length} chars.`,
        );
        rawFindings = await this.callGemini(systemPrompt, userPrompt, controller.signal);
        this.logger.log(`Gemini API returned ${rawFindings.length} findings.`);
      } else if (provider === 'openai') {
        rawFindings = await this.callOpenAi(systemPrompt, userPrompt, controller.signal);
      }

      // 4. Khử trùng lặp (Deduplication)
      const deduplicated = this.deduplicateFindings(rawFindings);

      return {
        provider,
        model,
        promptVersion: 'semantic-bms-react-v1',
        findings: deduplicated,
        durationMs: Date.now() - startTime,
      };
    } catch (error: any) {
      this.logger.warn(
        `BMS AI Validation call failed: ${error?.message || String(error)}. Gracefully falling back to heuristic validation engine.`,
      );
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
  ): Promise<BmsValidationFinding[]> {
    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    const configuredModel = this.config.get<string>('GEMINI_MODEL') || 'gemini-3.8-flash';
    if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');

    const candidateModels = [...new Set([configuredModel, 'gemini-3.7-flash', 'gemini-flash-latest'])];
    let lastError: Error | null = null;

    for (const model of candidateModels) {
      if (signal.aborted) throw new Error('Gemini API call timed out');
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

      for (let attempt = 1; attempt <= 2; attempt++) {
        if (signal.aborted) throw new Error('Gemini API call timed out');

        try {
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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
            const errText = await response.text();
            const isRateOrDemand = response.status === 503 || response.status === 429;
            if (isRateOrDemand) {
              this.logger.warn(
                `Gemini model ${model} returned ${response.status} (High demand/quota spike, attempt ${attempt}/2).`,
              );
              if (attempt < 2) {
                await new Promise((resolve) => setTimeout(resolve, 1500));
                continue;
              }
              lastError = new Error(`Gemini model ${model} error (${response.status}): ${errText}`);
              break;
            }
            throw new Error(`Gemini API error (${response.status}): ${errText}`);
          }

          const data = await response.json();
          const candidateText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!candidateText) return [];

          const parsed = JSON.parse(candidateText);
          return parsed.findings || [];
        } catch (err: any) {
          lastError = err;
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
  ): Promise<BmsValidationFinding[]> {
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
      const errText = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${errText}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return [];

    const parsed = JSON.parse(content);
    return parsed.findings || [];
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
        sourceLocation: { file: input.sourceFiles[0]?.path || 'source.bms', startLine: 1, endLine: 1 },
        targetLocation: { file: input.targetFiles[0]?.path || 'target.tsx', startLine: 1, endLine: 1 },
        explanation: 'BMS specifies numeric attribute (NUM) but React component does not declare inputMode="numeric".',
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
      const key = `${f.category}:${f.fieldName?.toUpperCase()}:${f.sourceLocation?.startLine}:${f.targetLocation?.startLine}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}
