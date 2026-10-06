import { ConfigService } from '@nestjs/config';
import { GeminiAiValidatorAdapter } from '../src/modules/validation/infrastructure/gemini-ai-validator.adapter';
import { AiValidationInput } from '../src/modules/validation/domain/ai-validator.port';
import { buildAiValidationJsonSchema } from '../src/modules/validation/infrastructure/ai-validation-output.validator';

describe('GeminiAiValidatorAdapter', () => {
  const values: Record<string, string | number> = {
    GEMINI_API_KEY: 'synthetic-gemini-key',
    GEMINI_MODEL: 'test-gemini-model',
    AI_PROMPT_VERSION: 'semantic-cobol-java-v1',
    AI_TIMEOUT_MS: 30,
    AI_MAX_RETRIES: 0,
    AI_MAX_FINDINGS: 2,
  };
  const config = { getOrThrow: jest.fn((key: string) => values[key]) };
  const adapter = new GeminiAiValidatorAdapter(config as unknown as ConfigService);
  const input: AiValidationInput = {
    conversionJobId: 'job-1',
    sourceFiles: [{ path: 'PROGRAM.cob', content: '1 | IDENTIFICATION DIVISION.', lineCount: 1 }],
    targetFiles: [{ path: 'Program.java', content: '1 | public class Program {}', lineCount: 1 }],
  };
  const validFinding = {
    category: 'LOGIC_MISMATCH',
    severity: 'HIGH',
    title: 'Conditional branch differs',
    explanation: 'The generated branch reverses the source condition.',
    expectedBehavior: 'Execute the debit branch for a positive amount.',
    actualBehavior: 'Executes the credit branch.',
    suggestion: 'Preserve the original condition.',
    sourceLocation: { file: 'PROGRAM.cob', startLine: 1, endLine: 1 },
    targetLocation: { file: 'Program.java', startLine: 1, endLine: 1 },
    confidence: 0.8,
  };

  beforeEach(() => {
    jest.restoreAllMocks();
    values.AI_TIMEOUT_MS = 30;
    values.AI_MAX_RETRIES = 0;
    values.AI_MAX_FINDINGS = 2;
  });

  it('returns configured metadata without a network request', () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch');
    expect(adapter.getMetadata()).toEqual({
      provider: 'gemini',
      model: 'test-gemini-model',
      promptVersion: 'semantic-cobol-java-v1',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the configured endpoint, header, shared prompt, and structured schema', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(response(200, generated({ findings: [validFinding] })));
    await expect(adapter.validate(input)).resolves.toEqual({
      findings: [expect.objectContaining({ title: validFinding.title })],
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/test-gemini-model:generateContent',
    );
    expect(String(url)).not.toContain(values.GEMINI_API_KEY);
    expect(init?.headers).toEqual({
      'x-goog-api-key': 'synthetic-gemini-key',
      'Content-Type': 'application/json',
    });
    const body = JSON.parse(String(init?.body));
    expect(body.systemInstruction.parts[0].text).toContain(
      'Perform semantic validation, not conversion.',
    );
    expect(body.contents[0].parts[0].text).toContain('PROGRAM.cob');
    expect(body.generationConfig).toEqual({
      candidateCount: 1,
      responseFormat: {
        text: {
          mimeType: 'APPLICATION_JSON',
          schema: expect.any(Object),
        },
      },
    });
    expect(body.generationConfig.responseFormat.text.mimeType).not.toBe('application/json');
    const providerSchema = body.generationConfig.responseFormat.text.schema;
    expect(providerSchema).not.toHaveProperty('properties.findings.maxItems');
    providerSchema.properties.findings.maxItems = values.AI_MAX_FINDINGS;
    expect(providerSchema).toStrictEqual(buildAiValidationJsonSchema(Number(values.AI_MAX_FINDINGS)));
  });

  it('accepts an ordinary empty findings result', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(response(200, generated({ findings: [] })));
    await expect(adapter.validate(input)).resolves.toEqual({ findings: [] });
  });

  it.each([2, 50])('accepts exactly the configured limit of %i findings', async (maxFindings) => {
    values.AI_MAX_FINDINGS = maxFindings;
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(response(200, generated({
      findings: Array.from({ length: maxFindings }, () => ({ ...validFinding })),
    })));
    await expect(adapter.validate(input)).resolves.toEqual({
      findings: Array.from({ length: maxFindings }, () => validFinding),
    });
  });

  it.each([2, 50])('rejects responses exceeding maxFindings=%i through ALSM validation', async (maxFindings) => {
    values.AI_MAX_FINDINGS = maxFindings;
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(response(200, generated({
      findings: Array.from({ length: maxFindings + 1 }, () => ({ ...validFinding })),
    })));
    await expect(adapter.validate(input)).rejects.toMatchObject({ code: 'AI_PROVIDER_RESPONSE_INVALID' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['malformed JSON', '{not-json'],
    ['invalid category', JSON.stringify({ findings: [{ ...validFinding, category: 'UNKNOWN' }] })],
    [
      'invalid location',
      JSON.stringify({
        findings: [
          { ...validFinding, sourceLocation: { file: 'other.cob', startLine: 1, endLine: 1 } },
        ],
      }),
    ],
    [
      'structurally invalid finding',
      JSON.stringify({ findings: [{ ...validFinding, extra: 'no' }] }),
    ],
    ['unknown top-level field', JSON.stringify({ findings: [], extra: 'no' })],
  ])('rejects %s with sanitized invalid-output error', async (_name, text) => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(response(200, generatedText(text)));
    await expect(adapter.validate(input)).rejects.toMatchObject({
      code: 'AI_PROVIDER_RESPONSE_INVALID',
    });
  });

  it('does not turn explicit provider blocking into empty findings', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        response(200, { promptFeedback: { blockReason: 'SAFETY' }, candidates: [] }),
      );
    await expect(adapter.validate(input)).rejects.toMatchObject({ code: 'AI_PROVIDER_REFUSED' });
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(response(200, { candidates: [{ finishReason: 'SAFETY' }] }));
    await expect(adapter.validate(input)).rejects.toMatchObject({ code: 'AI_PROVIDER_REFUSED' });
  });

  it.each([{}, { candidates: [{ content: { parts: [{ inlineData: { data: 'x' } }] } }] }])(
    'rejects missing usable candidate text',
    async (body) => {
      jest.spyOn(globalThis, 'fetch').mockResolvedValue(response(200, body));
      await expect(adapter.validate(input)).rejects.toMatchObject({
        code: 'AI_PROVIDER_RESPONSE_INVALID',
      });
    },
  );

  it.each([401, 403])('does not retry HTTP %s or reveal provider body', async (status) => {
    values.AI_MAX_RETRIES = 2;
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(response(status, { raw: 'sensitive-key-or-body' }));
    await expect(adapter.validate(input)).rejects.toMatchObject({
      code: 'AI_PROVIDER_AUTHENTICATION_FAILED',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([429, 500])('retries transient HTTP %s failures', async (status) => {
    values.AI_MAX_RETRIES = 1;
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(status, { raw: 'not-exposed' }))
      .mockResolvedValueOnce(response(200, generated({ findings: [] })));
    await expect(adapter.validate(input)).resolves.toEqual({ findings: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a permanent client rejection and never exposes the body', async () => {
    values.AI_MAX_RETRIES = 2;
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(response(400, { raw: 'private source' }));
    await expect(adapter.validate(input)).rejects.toMatchObject({
      code: 'AI_PROVIDER_REQUEST_REJECTED',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps an aborted request to the sanitized timeout error', async () => {
    jest.spyOn(globalThis, 'fetch').mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('private prompt')));
        }),
    );
    await expect(adapter.validate(input)).rejects.toMatchObject({
      code: 'AI_PROVIDER_TIMEOUT',
      message: 'AI provider request timed out',
    });
  });

  it('retries network failures within the configured hard maximum', async () => {
    values.AI_MAX_RETRIES = 99;
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('private prompt'))
      .mockRejectedValueOnce(new Error('private prompt'))
      .mockRejectedValueOnce(new Error('private prompt'))
      .mockRejectedValueOnce(new Error('private prompt'))
      .mockRejectedValueOnce(new Error('private prompt'))
      .mockResolvedValueOnce(response(200, generated({ findings: [] })));
    await expect(adapter.validate(input)).resolves.toEqual({ findings: [] });
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('sanitizes final network errors', async () => {
    values.AI_MAX_RETRIES = 0;
    jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('secret prompt and source contents'));
    await expect(adapter.validate(input)).rejects.toMatchObject({
      code: 'AI_PROVIDER_UNAVAILABLE',
      message: 'AI provider is unavailable',
    });
  });
});

function generated(value: unknown): Record<string, unknown> {
  return generatedText(JSON.stringify(value));
}

function generatedText(text: string): Record<string, unknown> {
  return { candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] };
}

function response(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}
