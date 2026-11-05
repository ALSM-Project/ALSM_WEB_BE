import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BmsAiValidatorAdapter } from '../src/modules/validation/infrastructure/bms-ai-validator.adapter';
import { PrepareAiValidationContextService } from '../src/modules/validation/application/prepare-ai-validation-context.service';
import { ValidationSecretRedactorService } from '../src/modules/validation/application/validation-secret-redactor.service';
import { ConversionType } from '../src/modules/projects/domain/project.types';

describe('BmsAiValidatorAdapter (mock HTTP only)', () => {
  const originalFetch = global.fetch;
  const fetchMock = jest.fn();
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
  let config: ConfigService;
  beforeEach(() => {
    global.fetch = fetchMock;
    fetchMock.mockReset();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    config = new ConfigService({
      AI_VALIDATION_ENABLED: true,
      AI_PROVIDER: 'openai',
      OPENAI_MODEL: 'test-openai',
      GEMINI_MODEL: 'gemini-test',
      OPENAI_API_KEY: 'synthetic-key',
      GEMINI_API_KEY: 'synthetic-key',
      AI_TIMEOUT_MS: 1_000,
      AI_MAX_FINDINGS: 5,
      AI_MAX_FILES: 5,
      AI_MAX_FILE_CHARS: 5_000,
      AI_MAX_TOTAL_CHARS: 10_000,
    });
  });
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });
  function openAi(content: unknown) {
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(content) } }] }),
    };
  }

  it('accepts valid structured findings and removes duplicate locations', async () => {
    fetchMock.mockResolvedValue(openAi({ findings: [finding, finding] }));
    const result = await new BmsAiValidatorAdapter(config).validate(input);
    expect(result.findings).toEqual([finding]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not collapse equal line numbers in different source files', async () => {
    const second = { ...finding, sourceLocation: { ...finding.sourceLocation, file: 'OTHER.bms' } };
    fetchMock.mockResolvedValue(openAi({ findings: [finding, second] }));
    const result = await new BmsAiValidatorAdapter(config).validate({
      ...input,
      sourceFiles: [...input.sourceFiles, { ...input.sourceFiles[0], path: 'OTHER.bms' }],
    });
    expect(result.findings).toHaveLength(2);
  });

  it.each([
    {},
    { findings: [{ ...finding, severity: 'INVALID' }] },
    { findings: [{ ...finding, targetLocation: { ...finding.targetLocation, endLine: 50 } }] },
  ])('falls back instead of accepting invalid provider output %#', async (output) => {
    fetchMock.mockResolvedValue(openAi(output));
    expect(await new BmsAiValidatorAdapter(config).validate(input)).toMatchObject({
      provider: 'heuristic-fallback',
    });
  });

  it('treats an absent response as failure rather than successful empty output', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ choices: [] }) });
    expect(await new BmsAiValidatorAdapter(config).validate(input)).toMatchObject({
      provider: 'heuristic-fallback',
    });
  });

  it('sends redacted, allowed, once-numbered context to the unchanged BMS prompt', async () => {
    fetchMock.mockResolvedValue(openAi({ findings: [] }));
    const prepared = new PrepareAiValidationContextService(
      new ValidationSecretRedactorService(),
      config,
    ).execute({
      organizationId: 'org',
      projectId: 'project',
      conversionJobId: 'job',
      conversionType: ConversionType.BMS_DSPF_TO_FRONTEND,
      sourceFiles: [
        {
          path: 'SCREEN.bms',
          content: '* comment\r\nPASSWORD="private-fixture"\r\nINITIAL=\'person@example.test\'',
        },
      ],
      targetFiles: [
        { path: 'Screen.tsx', content: '<input />' },
        { path: 'metadata.json', content: 'exclude-me' },
      ],
    });
    await new BmsAiValidatorAdapter(config).validate(prepared.input);
    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const transmitted = JSON.parse(request.messages[1].content);
    expect(transmitted.sourceFiles[0].numberedContent).toBe(prepared.input.sourceFiles[0].content);
    expect(transmitted.targetFiles).toHaveLength(1);
    expect(JSON.stringify(request)).not.toMatch(/private-fixture|person@example.test|exclude-me/);
    expect(request.messages[0].content).toContain('BMS / AS400 DSPF');
  });

  it('keeps Gemini credentials out of URLs and sends the domain schema', async () => {
    config.set('AI_PROVIDER', 'gemini');
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: '{"findings":[]}' }] } }] }),
    });
    await new BmsAiValidatorAdapter(config).validate(input);
    expect(fetchMock.mock.calls[0][0]).not.toContain('synthetic-key');
    expect(fetchMock.mock.calls[0][1].headers['x-goog-api-key']).toBe('synthetic-key');
    expect(
      JSON.parse(fetchMock.mock.calls[0][1].body).generationConfig.responseSchema,
    ).toBeDefined();
  });
});
