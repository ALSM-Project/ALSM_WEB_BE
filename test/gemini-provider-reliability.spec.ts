import { ConfigService } from '@nestjs/config';
import { GeminiAiValidatorAdapter } from '../src/modules/validation/infrastructure/gemini-ai-validator.adapter';
import { AiValidatorError } from '../src/modules/validation/domain/ai-validator.error';

describe('Gemini provider reliability diagnostics', () => {
  const secret = 'synthetic-secret-key-body-header-prompt';
  const input = {
    conversionJobId: 'synthetic',
    sourceFiles: [{ path: 'test.cbl', content: secret, lineCount: 1 }],
    targetFiles: [{ path: 'Test.java', content: secret, lineCount: 1 }],
  };
  let retries: number;
  let adapter: GeminiAiValidatorAdapter;

  beforeEach(() => {
    jest.useFakeTimers();
    retries = 2;
    adapter = new GeminiAiValidatorAdapter(
      new ConfigService({
        GEMINI_API_KEY: secret,
        GEMINI_MODEL: 'synthetic',
        AI_PROMPT_VERSION: 'semantic-cobol-java-v1',
        AI_TIMEOUT_MS: 1000,
        AI_MAX_FINDINGS: 2,
        get AI_MAX_RETRIES() {
          return retries;
        },
      }),
    );
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  async function failure(): Promise<AiValidatorError> {
    const result = adapter.validate(input).catch((error: unknown) => error);
    await jest.runAllTimersAsync();
    const error = await result;
    expect(error).toBeInstanceOf(AiValidatorError);
    return error as AiValidatorError;
  }

  function response(status: number, body: unknown = { raw: secret }): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers({ 'Retry-After': '120', 'x-private': secret }),
      json: jest.fn().mockResolvedValue(body),
    } as unknown as Response;
  }

  it.each([
    [429, 'RATE_LIMITED', 'AI_PROVIDER_UNAVAILABLE', 3, true],
    [500, 'SERVER_ERROR', 'AI_PROVIDER_UNAVAILABLE', 3, true],
    [503, 'SERVER_ERROR', 'AI_PROVIDER_UNAVAILABLE', 3, true],
    [400, 'REQUEST_REJECTED', 'AI_PROVIDER_REQUEST_REJECTED', 1, false],
    [401, 'AUTHENTICATION_FAILED', 'AI_PROVIDER_AUTHENTICATION_FAILED', 1, false],
    [403, 'AUTHENTICATION_FAILED', 'AI_PROVIDER_AUTHENTICATION_FAILED', 1, false],
  ])(
    'classifies HTTP %i without retaining payloads',
    async (status, finalFailureClass, code, attempts, retriesExhausted) => {
      const providerResponse = response(status as number);
      const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(providerResponse);
      const error = await failure();
      expect(error.code).toBe(code);
      expect(error.diagnostics).toEqual({
        finalFailureClass,
        httpStatus: status,
        attempts,
        retriesExhausted,
        totalLatencyMs: attempts === 3 ? 150 : 0,
      });
      expect(fetchMock).toHaveBeenCalledTimes(attempts as number);
      expect(providerResponse.json).not.toHaveBeenCalled();
      expect(typeof error.diagnostics?.httpStatus).toBe('number');
      expect(JSON.stringify(error.diagnostics)).not.toContain(secret);
      expect(JSON.stringify(error)).not.toContain('diagnostics');
    },
  );

  it.each([
    [0, 1, 0],
    [2, 3, 150],
    [99, 6, 1250],
  ])(
    'bounds retries=%i and includes backoff in latency',
    async (configured, attempts, totalLatencyMs) => {
      retries = configured;
      const fetchMock = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error(secret));
      const error = await failure();
      expect(error.diagnostics).toEqual({
        finalFailureClass: 'NETWORK_ERROR',
        attempts,
        retriesExhausted: true,
        totalLatencyMs,
      });
      expect(fetchMock).toHaveBeenCalledTimes(attempts);
      expect(JSON.stringify(error)).not.toContain(secret);
    },
  );

  it.each(['fetch', 'body'])(
    'classifies timeout during %s and counts every attempt',
    async (stage) => {
      jest.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
        const pending = new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error(secret)));
        });
        return stage === 'fetch'
          ? pending
          : Promise.resolve({
              ok: true,
              status: 200,
              json: () => pending,
            } as unknown as Response);
      });
      const error = await failure();
      expect(error.code).toBe('AI_PROVIDER_TIMEOUT');
      expect(error.diagnostics).toEqual({
        finalFailureClass: 'TIMEOUT',
        ...(stage === 'body' ? { httpStatus: 200 } : {}),
        attempts: 3,
        retriesExhausted: true,
        totalLatencyMs: 3150,
      });
    },
  );

  it('records the final cause and clears earlier HTTP status after a network failure', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(429))
      .mockResolvedValueOnce(response(503))
      .mockRejectedValue(new Error(secret));
    expect((await failure()).diagnostics).toEqual({
      finalFailureClass: 'NETWORK_ERROR',
      attempts: 3,
      retriesExhausted: true,
      totalLatencyMs: 150,
    });
  });

  it.each([
    [{ promptFeedback: { blockReason: 'SAFETY' } }, 'REFUSED', 'AI_PROVIDER_REFUSED'],
    [{ candidates: [{ finishReason: 'SAFETY' }] }, 'REFUSED', 'AI_PROVIDER_REFUSED'],
    [
      { candidates: [{ content: { parts: [{ text: '{invalid' }] } }] },
      'INVALID_OUTPUT',
      'AI_PROVIDER_RESPONSE_INVALID',
    ],
    [
      { candidates: [{ content: { parts: [{ text: '{"findings":[{}]}' }] } }] },
      'INVALID_OUTPUT',
      'AI_PROVIDER_RESPONSE_INVALID',
    ],
  ])(
    'preserves refusal/invalid output after a retried request',
    async (body, finalFailureClass, code) => {
      const fetchMock = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(response(503))
        .mockResolvedValue(response(200, body));
      const error = await failure();
      expect(error.code).toBe(code);
      expect(error.diagnostics).toEqual({
        finalFailureClass,
        httpStatus: 200,
        attempts: 2,
        retriesExhausted: false,
        totalLatencyMs: 50,
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it('does not retry invalid provider envelope JSON', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockRejectedValue(new SyntaxError(secret)),
    } as unknown as Response);
    const error = await failure();
    expect(error.code).toBe('AI_PROVIDER_RESPONSE_INVALID');
    expect(error.diagnostics).toEqual({
      finalFailureClass: 'INVALID_OUTPUT',
      httpStatus: 200,
      attempts: 1,
      retriesExhausted: false,
      totalLatencyMs: 0,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
