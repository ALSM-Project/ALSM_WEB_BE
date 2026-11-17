import { ConfigService } from '@nestjs/config';
import { CobolAiValidatorAdapter } from '../src/modules/validation/infrastructure/cobol-ai-validator.adapter';
import { CobolRuleValidationService } from '../src/modules/validation/application/cobol-rule-validation.service';
import { ValidationFindingCategory, ValidationFindingSeverity } from '../src/modules/validation/domain/validation-finding.types';
import { ValidationExecutionOutcome } from '../src/modules/validation/domain/validation-execution-metadata';
import { GeminiAiValidatorAdapter } from '../src/modules/validation/infrastructure/gemini-ai-validator.adapter';

describe('CobolAiValidatorAdapter (COBOL Hybrid Adapter)', () => {
  let adapter: CobolAiValidatorAdapter;
  let configService: ConfigService;
  let ruleService: CobolRuleValidationService;
  let mockGeminiAdapter: { validate: jest.Mock };

  const mockConfig: Record<string, any> = {
    AI_VALIDATION_ENABLED: 'false',
    AI_PROVIDER: 'fake',
    GEMINI_MODEL: 'gemini-2.5-flash',
    AI_TIMEOUT_MS: 5000,
  };

  beforeEach(() => {
    configService = {
      get: jest.fn((key: string) => mockConfig[key]),
    } as unknown as ConfigService;
    ruleService = new CobolRuleValidationService();
    mockGeminiAdapter = {
      validate: jest.fn(),
    };
    adapter = new CobolAiValidatorAdapter(
      configService,
      ruleService,
      mockGeminiAdapter as unknown as GeminiAiValidatorAdapter,
    );
  });

  const cobolContent = `
       IDENTIFICATION DIVISION.
       PROGRAM-ID. CBACT01C.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-BALANCE PIC S9(10)V99 COMP-3.
       PROCEDURE DIVISION.
       0000-MAIN.
           GOBACK.
  `;

  const javaContent = `
public class AccountProcess {
    private double wsBalance; // Type mismatch
    public void main() {}
}
  `;

  it('runs Deterministic Rule Engine immediately without external API call when AI is disabled (HEURISTIC_ONLY)', async () => {
    const input = {
      conversionJobId: 'job-cob-123',
      sourceFiles: [{ path: 'CBACT01C.cbl', content: cobolContent, lineCount: 10 }],
      targetFiles: [{ path: 'AccountProcess.java', content: javaContent, lineCount: 5 }],
    };

    const result = await adapter.validate(input);

    expect(result.execution?.outcome).toBe(ValidationExecutionOutcome.HEURISTIC_ONLY);
    expect(result.durationMs).toBeLessThan(100);
    expect(result.findings.length).toBeGreaterThan(0);
    expect(
      result.findings.some((f) => f.category === ValidationFindingCategory.DATA_TYPE_MISMATCH),
    ).toBe(true);
    expect(mockGeminiAdapter.validate).not.toHaveBeenCalled();
  });

  it('combines Rule Engine findings with AI findings when AI is enabled and successful (AI_COMPLETED)', async () => {
    mockConfig['AI_VALIDATION_ENABLED'] = 'true';
    mockConfig['AI_PROVIDER'] = 'gemini';

    const aiFinding = {
      category: ValidationFindingCategory.LOGIC_MISMATCH,
      severity: ValidationFindingSeverity.HIGH,
      title: 'Branch logic differs',
      explanation: 'Condition evaluation logic in branch is inverted.',
      sourceLocation: { file: 'CBACT01C.cbl', startLine: 8, endLine: 9 },
      targetLocation: { file: 'AccountProcess.java', startLine: 3, endLine: 3 },
      confidence: 0.85,
    };

    mockGeminiAdapter.validate.mockResolvedValue({
      findings: [aiFinding],
    });

    const input = {
      conversionJobId: 'job-cob-123',
      sourceFiles: [{ path: 'CBACT01C.cbl', content: cobolContent, lineCount: 10 }],
      targetFiles: [{ path: 'AccountProcess.java', content: javaContent, lineCount: 5 }],
    };

    const result = await adapter.validate(input);

    expect(result.execution?.outcome).toBe(ValidationExecutionOutcome.AI_COMPLETED);
    // Phải có cả finding từ Rule Engine (DATA_TYPE_MISMATCH) lẫn finding từ AI (LOGIC_MISMATCH)
    expect(
      result.findings.some((f) => f.category === ValidationFindingCategory.DATA_TYPE_MISMATCH),
    ).toBe(true);
    expect(
      result.findings.some((f) => f.category === ValidationFindingCategory.LOGIC_MISMATCH),
    ).toBe(true);
  });

  it('falls back safely to Rule Engine findings when AI call fails or times out (HEURISTIC_FALLBACK)', async () => {
    mockConfig['AI_VALIDATION_ENABLED'] = 'true';
    mockConfig['AI_PROVIDER'] = 'gemini';

    mockGeminiAdapter.validate.mockRejectedValue(new Error('AI provider connection timeout'));

    const input = {
      conversionJobId: 'job-cob-123',
      sourceFiles: [{ path: 'CBACT01C.cbl', content: cobolContent, lineCount: 10 }],
      targetFiles: [{ path: 'AccountProcess.java', content: javaContent, lineCount: 5 }],
    };

    const result = await adapter.validate(input);

    expect(result.execution?.outcome).toBe(ValidationExecutionOutcome.HEURISTIC_FALLBACK);
    expect(result.execution?.providerFailureCode).toBe('AI_PROVIDER_UNAVAILABLE');
    // Findings từ Rule Engine vẫn được bảo toàn nguyên vẹn
    expect(result.findings.length).toBeGreaterThan(0);
    expect(
      result.findings.some((f) => f.category === ValidationFindingCategory.DATA_TYPE_MISMATCH),
    ).toBe(true);
  });
});
