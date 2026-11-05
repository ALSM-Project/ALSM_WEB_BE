import { ConfigService } from '@nestjs/config';
import { BmsAiValidatorAdapter } from '../src/modules/validation/infrastructure/bms-ai-validator.adapter';
import { BmsSanitizerService } from '../src/modules/validation/application/bms-sanitizer.service';
import { BmsRuleValidationService } from '../src/modules/validation/application/bms-rule-validation.service';
import { BmsValidationCategory } from '../src/modules/validation/domain/bms-validation-taxonomy';

describe('BmsAiValidatorAdapter (Hybrid Architecture)', () => {
  let adapter: BmsAiValidatorAdapter;
  let configService: ConfigService;
  let sanitizerService: BmsSanitizerService;
  let ruleService: BmsRuleValidationService;

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
    sanitizerService = new BmsSanitizerService();
    ruleService = new BmsRuleValidationService();
    adapter = new BmsAiValidatorAdapter(configService, sanitizerService, ruleService);
  });

  const bmsContent = `
BNK1MAI DFHMSD TYPE=&SYSPARM,MODE=INOUT,LANG=COBOL
CARDNUM DFHMDF POS=(8,45),LENGTH=16,ATTRB=(UNPROT,NUM),INITIAL=' '
PASSWD  DFHMDF POS=(9,45),LENGTH=8,ATTRB=(UNPROT,DRK),INITIAL=' '
        DFHMSD TYPE=FINAL
        END
  `;

  const tsxContent = `
export function Screen() {
  return (
    <div>
      <input style={{ gridRow: 8, gridColumn: '45 / span 16' }} id="cardnum" type="text" maxLength={16} />
      <input style={{ gridRow: 9, gridColumn: '45 / span 8' }} id="passwd" type="text" maxLength={8} />
    </div>
  );
}
  `;

  it('runs Deterministic Rule Engine immediately without external API call when AI is disabled', async () => {
    const input = {
      conversionJobId: 'job-123',
      sourceFiles: [{ path: 'SCREEN.bms', content: bmsContent }],
      targetFiles: [{ path: 'Screen.tsx', content: tsxContent }],
    };

    const result = await adapter.validate(input);

    expect(result.provider).toBe('rule-based-engine');
    expect(result.durationMs).toBeLessThan(100); // cực nhanh (<100ms)
    expect(result.findings.length).toBeGreaterThan(0);

    // Phát hiện thiếu inputMode="numeric"
    expect(
      result.findings.some(
        (f) => f.category === BmsValidationCategory.ATTRIBUTE_MISMATCH && f.fieldName === 'CARDNUM',
      ),
    ).toBe(true);

    // Phát hiện type="password" bị lộ thành type="text"
    expect(
      result.findings.some(
        (f) => f.category === BmsValidationCategory.ATTRIBUTE_MISMATCH && f.fieldName === 'PASSWD',
      ),
    ).toBe(true);
  });

  it('falls back safely to Rule Engine findings when AI call fails or times out', async () => {
    mockConfig['AI_VALIDATION_ENABLED'] = 'true';
    mockConfig['AI_PROVIDER'] = 'gemini';
    mockConfig['GEMINI_API_KEY'] = 'fake-api-key';

    // Mock fetch ném lỗi (mạng hoặc quota hỏng)
    global.fetch = jest.fn().mockRejectedValue(new Error('Network error or quota exhausted'));

    const input = {
      conversionJobId: 'job-123',
      sourceFiles: [{ path: 'SCREEN.bms', content: bmsContent }],
      targetFiles: [{ path: 'Screen.tsx', content: tsxContent }],
    };

    const result = await adapter.validate(input);

    expect(result.provider).toBe('rule-based-fallback');
    expect(result.findings.length).toBeGreaterThan(0);
  });
});
