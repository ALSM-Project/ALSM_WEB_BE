import { validateBmsAiValidationOutput } from '../src/modules/validation/infrastructure/bms-ai-validation-output.validator';
import {
  validateAiValidationOutput,
  buildAiValidationJsonSchema,
} from '../src/modules/validation/infrastructure/ai-validation-output.validator';

describe('BMS structured output safety', () => {
  const input = {
    conversionJobId: 'job',
    sourceFiles: [{ path: 'SCREEN.bms', content: '1 | DFHMDF', lineCount: 1 }],
    targetFiles: [{ path: 'Screen.tsx', content: '1 | <input />', lineCount: 1 }],
  };
  const finding = {
    category: 'ATTRIBUTE_MISMATCH',
    severity: 'HIGH',
    fieldName: 'CARDNUM',
    sourceLocation: { file: 'SCREEN.bms', startLine: 1, endLine: 1 },
    targetLocation: { file: 'Screen.tsx', startLine: 1, endLine: 1 },
    explanation: 'Numeric attribute is missing.',
    suggestion: 'Add inputMode="numeric".',
  };
  it('accepts the BMS field contract and a successful empty result', () => {
    expect(validateBmsAiValidationOutput({ findings: [finding] }, input, 5)).toEqual([finding]);
    expect(validateBmsAiValidationOutput({ findings: [] }, input, 5)).toEqual([]);
  });
  it.each([
    null,
    {},
    { findings: {} },
    { findings: [{ ...finding, category: 'LOGIC_MISMATCH' }] },
    { findings: [{ ...finding, severity: 'BLOCKER' }] },
    { findings: [{ ...finding, fieldName: '' }] },
    { findings: [{ ...finding, fieldName: 'x'.repeat(251) }] },
    { findings: [{ ...finding, explanation: 'x'.repeat(4001) }] },
    { findings: [{ ...finding, confidence: 2 }] },
    { findings: [{ ...finding, status: 'RESOLVED' }] },
    { findings: [{ ...finding, sourceLocation: { file: 'other.bms', startLine: 1, endLine: 1 } }] },
    {
      findings: [{ ...finding, targetLocation: { file: 'Screen.tsx', startLine: 1, endLine: 2 } }],
    },
    {
      findings: [{ ...finding, targetLocation: { file: 'Screen.tsx', startLine: 0, endLine: 1 } }],
    },
    {
      findings: [{ ...finding, targetLocation: { file: 'Screen.tsx', startLine: 1, endLine: 0 } }],
    },
    { findings: [{ ...finding, targetLocation: null }] },
    { findings: [finding, finding] },
  ])('rejects malformed, unbounded or cross-domain output %#', (output) => {
    expect(() => validateBmsAiValidationOutput(output, input, 1)).toThrow(
      expect.objectContaining({ code: 'AI_PROVIDER_RESPONSE_INVALID' }),
    );
  });
  it('keeps BMS categories out of the COBOL schema and runtime output', () => {
    expect(JSON.stringify(buildAiValidationJsonSchema(5))).not.toContain('ATTRIBUTE_MISMATCH');
    expect(() =>
      validateAiValidationOutput(
        {
          findings: [
            {
              ...finding,
              title: 'Field',
              fieldName: undefined,
              expectedBehavior: null,
              actualBehavior: null,
              confidence: null,
            },
          ],
        },
        input,
        5,
      ),
    ).toThrow(expect.objectContaining({ code: 'AI_PROVIDER_RESPONSE_INVALID' }));
  });
});
