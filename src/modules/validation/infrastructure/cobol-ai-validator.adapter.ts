import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CobolRuleValidationService } from '../application/cobol-rule-validation.service';
import {
  AiValidationFindingDraft,
  AiValidationInput,
  AiValidationResult,
  AiValidatorMetadata,
  AiValidatorPort,
} from '../domain/ai-validator.port';
import { AiValidatorError } from '../domain/ai-validator.error';
import { SEMANTIC_COBOL_JAVA_PROMPT_VERSION } from './ai-validation.prompt';
import { ValidationExecutionOutcome } from '../domain/validation-execution-metadata';
import { GeminiAiValidatorAdapter } from './gemini-ai-validator.adapter';
import { OpenAiValidatorAdapter } from './openai-ai-validator.adapter';

export interface CobolAiValidationResult extends AiValidationResult {
  provider?: string;
  model?: string;
  promptVersion?: string;
  durationMs?: number;
}

/**
 * BỘ ĐIỀU PHỐI HYBRID CHO COBOL -> JAVA:
 * 1. Chạy Deterministic Rule Engine trước (< 5ms): Bắt các lỗi kỹ thuật cơ bản:
 *    - DATA_TYPE_MISMATCH (COMP-3/Decimal vs double/float/String)
 *    - VARIABLE_MAPPING_MISMATCH (biến 01/77 bị rơi rụng)
 *    - MISSING_OPERATION (Paragraphs trong PROCEDURE DIVISION bị thiếu)
 *    - DATABASE_MISMATCH (EXEC SQL bị thiếu)
 *    - FILE_IO_MISMATCH (thao tác File I/O bị thiếu)
 * 2. Khi AI tắt hoặc dùng fake provider: Trả kết quả ngay lập tức trong vài mili-giây (HEURISTIC_ONLY).
 * 3. Khi AI bật: Gọi LLM (Gemini / OpenAI) để thẩm định sâu semantic logic, gộp kết quả và khử trùng lặp (AI_COMPLETED).
 * 4. Graceful Fallback: Nếu AI sập, hết quota hoặc timeout -> Tự động fallback về kết quả Rule Engine (HEURISTIC_FALLBACK).
 */
@Injectable()
export class CobolAiValidatorAdapter implements AiValidatorPort {
  private readonly logger = new Logger(CobolAiValidatorAdapter.name);

  constructor(
    private readonly config: ConfigService,
    private readonly ruleEngine: CobolRuleValidationService,
    @Optional() private readonly geminiAdapter?: GeminiAiValidatorAdapter,
    @Optional() private readonly openAiAdapter?: OpenAiValidatorAdapter,
  ) {}

  getMetadata(): AiValidatorMetadata {
    const provider = this.config.get<string>('AI_PROVIDER') || 'fake';
    return {
      provider,
      model:
        provider === 'gemini'
          ? this.config.get<string>('GEMINI_MODEL') || 'gemini-2.5-flash'
          : provider === 'openai'
            ? this.config.get<string>('OPENAI_MODEL') || 'gpt-4o-mini'
            : 'heuristic-rules',
      promptVersion: SEMANTIC_COBOL_JAVA_PROMPT_VERSION,
    };
  }

  async validate(input: AiValidationInput): Promise<CobolAiValidationResult> {
    const startTime = Date.now();
    const rawEnabled = this.config.get('AI_VALIDATION_ENABLED');
    const enabled = rawEnabled === true || rawEnabled === 'true';
    const provider = this.config.get<string>('AI_PROVIDER') || 'fake';
    const metadata = this.getMetadata();

    // 1. Chạy Deterministic Rule Engine trước (< 5ms)
    const sourceFile = input.sourceFiles[0];
    const targetFile = input.targetFiles[0];
    const ruleResult =
      sourceFile && targetFile
        ? this.ruleEngine.validate(sourceFile, targetFile)
        : { findings: [] };

    this.logger.log(
      `[COBOL Hybrid Validation] Deterministic Rule Engine completed in ${Date.now() - startTime}ms. Detected ${ruleResult.findings.length} findings.`,
    );

    // 2. Nếu tắt AI Validation hoặc dùng Fake provider -> Trả ngay kết quả từ Rule Engine
    if (!enabled || provider === 'fake') {
      return {
        findings: ruleResult.findings,
        execution: {
          outcome: ValidationExecutionOutcome.HEURISTIC_ONLY,
          provider: 'fake',
          model: 'heuristic-rules',
        },
        durationMs: Date.now() - startTime,
      };
    }

    // 3. Nếu AI được kích hoạt -> Thử gọi LLM
    try {
      let aiResult: AiValidationResult;

      if (provider === 'gemini') {
        if (!this.geminiAdapter) {
          throw new AiValidatorError('AI_PROVIDER_UNAVAILABLE', 'Gemini adapter is not configured');
        }
        this.logger.log(`[COBOL Hybrid Validation] Calling Gemini semantic validator (${metadata.model})...`);
        aiResult = await this.geminiAdapter.validate(input);
      } else if (provider === 'openai') {
        if (!this.openAiAdapter) {
          throw new AiValidatorError('AI_PROVIDER_UNAVAILABLE', 'OpenAI adapter is not configured');
        }
        this.logger.log(`[COBOL Hybrid Validation] Calling OpenAI semantic validator (${metadata.model})...`);
        aiResult = await this.openAiAdapter.validate(input);
      } else {
        throw new AiValidatorError('AI_PROVIDER_REQUEST_REJECTED', 'Unsupported AI provider');
      }

      // Hợp nhất kết quả Rule Engine và AI, loại bỏ trùng lặp
      const combined = this.deduplicateFindings([...ruleResult.findings, ...aiResult.findings]);

      this.logger.log(
        `[COBOL Hybrid Validation] Finished in ${Date.now() - startTime}ms. Rule findings: ${ruleResult.findings.length}, AI findings: ${aiResult.findings.length}, Combined: ${combined.length}`,
      );

      return {
        ...aiResult,
        findings: combined,
        execution: {
          outcome: ValidationExecutionOutcome.AI_COMPLETED,
          provider: metadata.provider,
          model: metadata.model,
        },
        durationMs: Date.now() - startTime,
      };
    } catch (error: unknown) {
      const code =
        error instanceof AiValidatorError
          ? error.code
          : 'AI_PROVIDER_UNAVAILABLE';
      const msg = error instanceof Error ? error.message : String(error);

      this.logger.warn(
        `[COBOL Hybrid Validation] AI call failed (${code}): ${msg}. Gracefully falling back to Rule Engine findings.`,
      );

      // 4. Graceful Fallback: Trả về kết quả Rule Engine an toàn
      return {
        findings: ruleResult.findings,
        execution: {
          outcome: ValidationExecutionOutcome.HEURISTIC_FALLBACK,
          provider: 'heuristic-fallback',
          model: 'heuristic-rules-v1',
          providerFailureCode: code,
        },
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Khử các lỗi trùng lặp (Deduplication)
   */
  private deduplicateFindings(findings: AiValidationFindingDraft[]): AiValidationFindingDraft[] {
    const seen = new Set<string>();
    return findings.filter((f) => {
      const key = `${f.category}:${f.sourceLocation?.file}:${f.sourceLocation?.startLine}:${f.targetLocation?.file}:${f.targetLocation?.startLine}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}
