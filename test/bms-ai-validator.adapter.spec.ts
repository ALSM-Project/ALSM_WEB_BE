import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BmsAiValidatorAdapter } from '../src/modules/validation/infrastructure/bms-ai-validator.adapter';
import { PrepareAiValidationContextService } from '../src/modules/validation/application/prepare-ai-validation-context.service';
import { ValidationSecretRedactorService } from '../src/modules/validation/application/validation-secret-redactor.service';
import { ConversionType } from '../src/modules/projects/domain/project.types';
import { AI_RESPONSE_METADATA } from '../src/modules/validation/domain/ai-response-metadata';

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
    jest.useRealTimers();
  });
  function openAi(content: unknown) {
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(content) } }] }),
    };
  }

  it.each([
    [401, 'AI_PROVIDER_AUTHENTICATION_FAILED'],
    [429, 'AI_PROVIDER_UNAVAILABLE'],
    [503, 'AI_PROVIDER_UNAVAILABLE'],
  ])('keeps fallback findings with the safe failure code for HTTP %s', async (status, code) => {
    fetchMock.mockResolvedValue({ ok: false, status, text: async () => 'private-provider-error' });
    const result = await new BmsAiValidatorAdapter(config).validate({
      ...input,
      sourceFiles: [{ ...input.sourceFiles[0], content: '1 | ATTRB=(UNPROT,NUM)' }],
    });
    expect(result).toMatchObject({
      provider: 'heuristic-fallback',
      model: 'heuristic-rules-v1',
      execution: { outcome: 'HEURISTIC_FALLBACK', providerFailureCode: code },
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].confidence).toBeUndefined();
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      expect.not.stringContaining('private-provider-error'),
    );
  });

  it('keeps AI disabled as heuristic-only without transmitting files', async () => {
    config.set('AI_VALIDATION_ENABLED', false);
    const result = await new BmsAiValidatorAdapter(config).validate(input);
    expect(result.execution?.outcome).toBe('HEURISTIC_ONLY');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('attributes malformed JSON and refusal separately from provider availability', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{' } }] }),
    });
    expect(
      (await new BmsAiValidatorAdapter(config).validate(input)).execution?.providerFailureCode,
    ).toBe('AI_PROVIDER_RESPONSE_INVALID');
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { refusal: 'Refused' } }] }),
    });
    expect(
      (await new BmsAiValidatorAdapter(config).validate(input)).execution?.providerFailureCode,
    ).toBe('AI_PROVIDER_REFUSED');
  });

  it('marks timeout fallback without leaking an exception message', async () => {
    jest.useFakeTimers();
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new Error('private-transport-error')),
          );
        }),
    );
    const pending = new BmsAiValidatorAdapter(config).validate(input);
    await jest.runAllTimersAsync();
    expect((await pending).execution?.providerFailureCode).toBe('AI_PROVIDER_TIMEOUT');
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      expect.not.stringContaining('private-transport-error'),
    );
  });

  it.each([500, 503])('records the successful Gemini candidate request after HTTP %s', async (status) => {
    jest.useFakeTimers();
    config.set('AI_TIMEOUT_MS', 10_000);
    config.set('AI_PROVIDER', 'gemini');
    fetchMock
      .mockResolvedValueOnce({ ok: false, status })
      .mockResolvedValueOnce({ ok: false, status })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          modelVersion: 'gemini-observed-v1',
          candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"findings":[]}' }] } }],
        }),
      });
    const pending = new BmsAiValidatorAdapter(config).validate(input);
    await jest.advanceTimersByTimeAsync(1_500);
    const result = await pending;
    expect(result).toMatchObject({
      model: 'gemini-3.7-flash',
      execution: { outcome: 'AI_COMPLETED', model: 'gemini-3.7-flash' },
    });
    expect(result[AI_RESPONSE_METADATA]).toEqual({
      requestedModel: 'gemini-3.7-flash',
      modelVersion: 'gemini-observed-v1',
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][0]).toContain('gemini-3.7-flash');
  });

  it.each([undefined, 'secret response payload', 'gemini-bad\nvalue'])(
    'does not infer a model version from %p',
    async (modelVersion) => {
      config.set('AI_PROVIDER', 'gemini');
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          modelVersion,
          candidates: [{ content: { parts: [{ text: '{"findings":[]}' }] } }],
        }),
      });
      const result = await new BmsAiValidatorAdapter(config).validate(input);
      expect(result[AI_RESPONSE_METADATA]?.modelVersion).toBeUndefined();
    },
  );

  it('accepts valid structured findings and removes duplicate locations', async () => {
    fetchMock.mockResolvedValue(openAi({ findings: [finding, finding] }));
    const result = await new BmsAiValidatorAdapter(config).validate(input);
    expect(result.findings).toEqual([expect.objectContaining(finding)]);
    expect(result).toMatchObject({
      provider: 'openai',
      model: 'test-openai',
      execution: { outcome: 'AI_COMPLETED', provider: 'openai', model: 'test-openai' },
    });
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
