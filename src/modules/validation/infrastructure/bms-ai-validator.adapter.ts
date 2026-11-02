import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BmsSanitizerService } from '../application/bms-sanitizer.service';
import { BmsRuleValidationService } from '../application/bms-rule-validation.service';
import {
  BMS_VALIDATION_JSON_SCHEMA,
  BmsValidationFinding,
} from '../domain/bms-validation-taxonomy';
import { buildBmsAiValidationPrompt } from './bms-ai-validation.prompt';

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
 * BƯỚC 6: TÍCH HỢP KIẾN TRÚC HYBRID ("Rule-based/AST trước, AI sau")
 * 1. Rule Engine (< 10ms): Bóc tách AST/Regex, so khớp 100% thuộc tính cơ học:
 *    - MISSING_FIELD
 *    - ATTRIBUTE_MISMATCH (NUM, DRK/Password, LENGTH/maxLength, PROT/ReadOnly)
 *    - LAYOUT_DISCREPANCY (gridRow, gridColumn)
 *    - PF_KEY_MISMATCH (F3, F12, Enter...)
 * 2. Selective AI (1-2s): Chỉ gọi AI để thẩm định các logic ngữ nghĩa nâng cao (SEMANTIC_LOGIC)
 *    hoặc khi cấu hình kích hoạt AI sâu.
 * 3. Graceful Fallback: Nếu AI sập/timeout/hết quota -> vẫn giữ 100% kết quả từ Rule Engine.
 */
@Injectable()
export class BmsAiValidatorAdapter {
  private readonly logger = new Logger(BmsAiValidatorAdapter.name);

  constructor(
    private readonly config: ConfigService,
    private readonly sanitizer: BmsSanitizerService,
    private readonly ruleEngine: BmsRuleValidationService,
  ) {}

  async validate(input: BmsAiValidationInput): Promise<BmsAiValidationResult> {
    const startTime = Date.now();
    const rawEnabled = this.config.get('AI_VALIDATION_ENABLED');
    const enabled = rawEnabled === true || rawEnabled === 'true';
    const provider = this.config.get<string>('AI_PROVIDER') || 'fake';
    const model =
      this.config.get<string>('GEMINI_MODEL') ||
      this.config.get<string>('OPENAI_MODEL') ||
      'gemini-2.5-flash';
    const timeoutMs = this.config.get<number>('AI_TIMEOUT_MS') || 30000;

    // 1. BƯỚC 1 & 2: Chạy Deterministic Rule Engine ngay lập tức (< 10ms)
    const sourceFile = input.sourceFiles[0];
    const targetFile =
      input.targetFiles.find((f) => !f.path.toLowerCase().endsWith('.json')) ||
      input.targetFiles[0];

    const ruleResult =
      sourceFile && targetFile
        ? this.ruleEngine.validate(sourceFile, targetFile)
        : { findings: [], ambiguousItems: [] };

    const ruleTime = Date.now() - startTime;
    this.logger.log(
      `[Hybrid Validation] Deterministic Rule Engine finished in ${ruleTime}ms. Detected ${ruleResult.findings.length} findings.`,
    );

    // 2. Nếu tắt AI Validation hoặc dùng Fake provider -> Trả ngay kết quả từ Rule Engine
    if (!enabled || provider === 'fake') {
      return {
        provider: 'rule-based-engine',
        model: 'deterministic-rules-v2',
        promptVersion: 'semantic-bms-react-v1',
        findings: ruleResult.findings,
        durationMs: Date.now() - startTime,
      };
    }

    // 3. Tiền xử lý & Khử PII cho ngữ cảnh AI
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

    // 4. Gọi AI với Timeout an toàn
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    try {
      let aiFindings: BmsValidationFinding[] = [];

      if (provider === 'gemini') {
        this.logger.log(
          `[Hybrid Validation] Delegating semantic checks to Gemini (${model})...`,
        );
        aiFindings = await this.callGemini(systemPrompt, userPrompt, controller.signal);
      } else if (provider === 'openai') {
        this.logger.log(
          `[Hybrid Validation] Delegating semantic checks to OpenAI (${model})...`,
        );
        aiFindings = await this.callOpenAi(systemPrompt, userPrompt, controller.signal);
      }

      // 5. Hợp nhất kết quả Rule-based và AI-based, sau đó loại bỏ trùng lặp
      const combined = [...ruleResult.findings, ...aiFindings];
      const deduplicated = this.deduplicateFindings(combined);

      this.logger.log(
        `[Hybrid Validation] Complete in ${Date.now() - startTime}ms. Rule findings: ${ruleResult.findings.length}, AI findings: ${aiFindings.length}, Total deduplicated: ${deduplicated.length}`,
      );

      return {
        provider,
        model,
        promptVersion: 'semantic-bms-react-v1',
        findings: deduplicated,
        durationMs: Date.now() - startTime,
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[Hybrid Validation] AI call failed or timed out: ${msg}. Safely falling back to 100% deterministic Rule Engine findings.`,
      );
      return {
        provider: 'rule-based-fallback',
        model: 'deterministic-rules-v2',
        promptVersion: 'semantic-bms-react-v1',
        findings: ruleResult.findings,
        durationMs: Date.now() - startTime,
      };
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  /**
   * Gọi Google Gemini API với JSON Schema ép buộc và danh sách model thực tế
   */
  private async callGemini(
    systemPrompt: string,
    userPrompt: string,
    signal: AbortSignal,
  ): Promise<BmsValidationFinding[]> {
    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    const configuredModel = this.config.get<string>('GEMINI_MODEL') || 'gemini-2.5-flash';
    if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');

    // Chỉ dùng các model Gemini có thực và phản hồi nhanh nhất của Google
    const candidateModels = [
      ...new Set([configuredModel, 'gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-2.0-flash']),
    ];
    let lastError: Error | null = null;

    for (const model of candidateModels) {
      if (signal.aborted) throw new Error('Gemini API call timed out');
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

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
          this.logger.warn(`Gemini model ${model} responded with ${response.status}: ${errText}`);
          lastError = new Error(`Gemini model ${model} error (${response.status})`);
          continue; // Thử model tiếp theo trong danh sách
        }

        const data = await response.json();
        const candidateText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!candidateText) return [];

        const parsed = JSON.parse(candidateText);
        return parsed.findings || [];
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (signal.aborted) throw err;
      }
    }

    throw lastError || new Error('All Gemini candidate models failed');
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
   * Khử các lỗi trùng lặp (Deduplication) giữa Rule Engine và AI
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
