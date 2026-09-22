import { ConfigService } from '@nestjs/config';
import { OpenAiValidatorAdapter } from '../src/modules/validation/infrastructure/openai-ai-validator.adapter';
import { AiValidationInput } from '../src/modules/validation/domain/ai-validator.port';

describe('OpenAiValidatorAdapter', () => {
  const values: Record<string, string | number> = {
    OPENAI_API_KEY: 'synthetic-test-key',
    OPENAI_MODEL: 'test-model',
    AI_PROMPT_VERSION: 'semantic-cobol-java-v1',
    AI_TIMEOUT_MS: 30,
    AI_MAX_RETRIES: 0,
    AI_MAX_FINDINGS: 2,
  };
  const config = {
    getOrThrow: jest.fn((key: string) => values[key]),
  };
  const adapter = new OpenAiValidatorAdapter(config as unknown as ConfigService);
  const input: AiValidationInput = {
    conversionJobId: 'job-1',
    sourceFiles: [
      { path: 'PROGRAM.cob', content: '1 | IDENTIFICATION DIVISION.', lineCount: 1 },
    ],
    targetFiles: [
      { path: 'Program.java', content: '1 | public class Program {}', lineCount: 1 },
    ],
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

  it('uses the stateless Responses API with strict structured output and no tools', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      response(200, completed({ findings: [validFinding] })),
    );

    await expect(adapter.validate(input)).resolves.toEqual({
      findings: [expect.objectContaining({ title: 'Conditional branch differs', confidence: 0.8 })],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(init?.headers).toEqual({
      Authorization: 'Bearer synthetic-test-key',
      'Content-Type': 'application/json',
    });
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toEqual(
      expect.objectContaining({
        model: 'test-model',
        store: false,
        tools: [],
        tool_choice: 'none',
        truncation: 'disabled',
        text: expect.objectContaining({
          format: expect.objectContaining({ type: 'json_schema', strict: true }),
        }),
      }),
    );
    expect(body).not.toHaveProperty('conversation');
    expect(body).not.toHaveProperty('previous_response_id');
  });

  it('extracts output text without assuming the first output item is the message', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      response(200, {
        status: 'completed',
        output: [
          { type: 'reasoning', content: [] },
          {
            type: 'message',
            content: [{ type: 'output_text', text: JSON.stringify({ findings: [] }) }],
          },
        ],
      }),
    );

    await expect(adapter.validate(input)).resolves.toEqual({ findings: [] });
  });

  it.each([
    ['malformed JSON', '{not-json'],
    ['invalid schema', JSON.stringify({ findings: [{ ...validFinding, severity: 'UNKNOWN' }] })],
    [
      'unexpected properties',
      JSON.stringify({ findings: [{ ...validFinding, persistenceId: 'provider-controlled' }] }),
    ],
    ['missing title', JSON.stringify({ findings: [{ ...validFinding, title: undefined }] })],
    [
      'confidence outside the accepted range',
      JSON.stringify({ findings: [{ ...validFinding, confidence: 1.1 }] }),
    ],
  ])('rejects %s output', async (_name, text) => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(response(200, completedText(text)));

    await expect(adapter.validate(input)).rejects.toMatchObject({
      code: 'AI_PROVIDER_RESPONSE_INVALID',
      message: 'AI provider returned an invalid validation response',
    });
  });

  it('rejects excessive findings', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      response(200, completed({ findings: [validFinding, validFinding, validFinding] })),
    );

    await expect(adapter.validate(input)).rejects.toMatchObject({
      code: 'AI_PROVIDER_RESPONSE_INVALID',
    });
  });

  it('strictly rejects locations outside the prepared files', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      response(
        200,
        completed({
          findings: [
            { ...validFinding, sourceLocation: { file: 'PROGRAM.cob', startLine: 1, endLine: 2 } },
          ],
        }),
      ),
    );

    await expect(adapter.validate(input)).rejects.toMatchObject({
      code: 'AI_PROVIDER_RESPONSE_INVALID',
    });
  });

  it('returns a sanitized timeout error', async () => {
    jest.spyOn(globalThis, 'fetch').mockImplementation((_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('request body leaked')));
      }),
    );

    await expect(adapter.validate(input)).rejects.toMatchObject({
      code: 'AI_PROVIDER_TIMEOUT',
      message: 'AI provider request timed out',
    });
  });

  it.each([429, 500])('retries HTTP %s only within the configured bound', async (status) => {
    values.AI_MAX_RETRIES = 1;
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(status, { raw: 'must not surface' }))
      .mockResolvedValueOnce(response(200, completed({ findings: [] })));

    await expect(adapter.validate(input)).resolves.toEqual({ findings: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([401, 403])('does not retry HTTP %s or expose the provider body', async (status) => {
    values.AI_MAX_RETRIES = 2;
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(response(status, { raw: 'sensitive provider body' }));

    await expect(adapter.validate(input)).rejects.toMatchObject({
      code: 'AI_PROVIDER_AUTHENTICATION_FAILED',
      message: 'AI provider authentication failed',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects incomplete and refusal responses without exposing provider content', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      response(200, { status: 'incomplete', output: [], raw: 'source body' }),
    );
    await expect(adapter.validate(input)).rejects.toMatchObject({
      code: 'AI_PROVIDER_RESPONSE_INVALID',
    });

    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      response(200, {
        status: 'completed',
        output: [
          {
            type: 'message',
            content: [{ type: 'refusal', refusal: 'provider refusal details' }],
          },
        ],
      }),
    );
    await expect(adapter.validate(input)).rejects.toMatchObject({
      code: 'AI_PROVIDER_REFUSED',
      message: 'AI provider refused the validation request',
    });
  });
});

function completed(value: unknown): Record<string, unknown> {
  return completedText(JSON.stringify(value));
}

function completedText(text: string): Record<string, unknown> {
  return {
    status: 'completed',
    output: [{ type: 'message', content: [{ type: 'output_text', text }] }],
  };
}

function response(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}
