import { ConfigService } from '@nestjs/config';
import { GeminiAiValidatorAdapter } from '../src/modules/validation/infrastructure/gemini-ai-validator.adapter';
import { AiValidatorError } from '../src/modules/validation/domain/ai-validator.error';
import {
  geminiBackoffMs,
  geminiRateLimitScope,
  retryAfterMs,
} from '../src/modules/validation/infrastructure/gemini-retry-policy';

const daily = 'GenerateRequestsPerDayPerProjectPerModel-FreeTier';
const minute = 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier';
const sensitive = 'synthetic-private-marker';
function quota(...ids: string[]) {
  return {
    error: {
      status: 'RESOURCE_EXHAUSTED',
      message: sensitive,
      details: [
        {
          '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
          violations: ids.map((quotaId) => ({ quotaId, description: sensitive })),
        },
      ],
    },
  };
}
function response(status: number, header?: string, body: unknown = {}) {
  return {
    ok: status === 200,
    status,
    headers: new Headers(header === undefined ? {} : { 'Retry-After': header }),
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe('Gemini quota policy', () => {
  const now = Date.parse('2026-10-06T00:00:00Z');
  it.each([
    ['2', 2000],
    ['0', 0],
    [' 12 ', 12000],
    ['Tue, 06 Oct 2026 00:00:10 GMT', 10000],
    ['Tuesday, 06-Oct-26 00:00:10 GMT', 10000],
    ['Tue Oct  6 00:00:10 2026', 10000],
    [null, undefined],
    ['garbage', undefined],
    ['-1', undefined],
    ['1.5', undefined],
    ['Infinity', undefined],
    ['1e3', undefined],
    ['9'.repeat(400), undefined],
    ['Mon, 05 Oct 2026 23:59:59 GMT', undefined],
    ['Tue, 31 Feb 2026 00:00:10 GMT', undefined],
    ['Tue, 06 Oct 2026 25:00:00 GMT', undefined],
    ['2026-10-06T00:00:10Z', undefined],
  ])('sanitizes Retry-After %s', (header, expected) => {
    expect(retryAfterMs(header, now)).toBe(expected);
  });

  it('uses exponential delays, bounded positive jitter and an absolute cap', () => {
    expect([0, 1, 2, 3, 4].map((n) => geminiBackoffMs(n, 0))).toEqual([
      1000, 2000, 4000, 8000, 8000,
    ]);
    expect([0, 1, 2, 3, 4].map((n) => geminiBackoffMs(n, 1))).toEqual([
      1250, 2500, 5000, 8000, 8000,
    ]);
    for (const random of [0, 0.25, 0.5, 0.999999]) {
      expect(geminiBackoffMs(0, random)).toBeGreaterThanOrEqual(1000);
      expect(geminiBackoffMs(0, random)).toBeLessThanOrEqual(1250);
      expect(geminiBackoffMs(20, random)).toBe(8000);
    }
  });

  it.each([
    [[minute], 'SHORT_WINDOW'],
    [[daily], 'DAILY_QUOTA'],
    [[minute, daily], 'DAILY_QUOTA'],
    [['new-daily-name'], 'UNKNOWN'],
    [[minute, 'new-name'], 'UNKNOWN'],
    [[], 'UNKNOWN'],
  ])('classifies exact quota IDs %j', (ids, expected) => {
    expect(geminiRateLimitScope(quota(...ids))).toBe(expected);
  });
  it('does not infer quota scope from text or an untyped detail', () => {
    expect(geminiRateLimitScope({ error: { message: daily } })).toBe('UNKNOWN');
    expect(
      geminiRateLimitScope({
        error: { status: 'RESOURCE_EXHAUSTED', details: [{ violations: [{ quotaId: daily }] }] },
      }),
    ).toBe('UNKNOWN');
    expect(geminiRateLimitScope(null)).toBe('UNKNOWN');
  });
});

describe('Gemini quota-aware transport', () => {
  const input = {
    conversionJobId: 'synthetic',
    sourceFiles: [{ path: 'a.cbl', content: sensitive, lineCount: 1 }],
    targetFiles: [{ path: 'A.java', content: sensitive, lineCount: 1 }],
  };
  let adapter: GeminiAiValidatorAdapter;
  let config: ConfigService;
  beforeEach(() => {
    jest.useFakeTimers({ now: Date.parse('2026-10-06T00:00:00Z') });
    jest.spyOn(Math, 'random').mockReturnValue(0);
    config = new ConfigService({
      GEMINI_API_KEY: sensitive,
      GEMINI_MODEL: 'synthetic',
      AI_PROMPT_VERSION: 'semantic-cobol-java-v1',
      AI_TIMEOUT_MS: 1000,
      AI_MAX_RETRIES: 2,
      AI_MAX_FINDINGS: 2,
      GEMINI_MIN_REQUEST_INTERVAL_MS: 0,
    });
    adapter = new GeminiAiValidatorAdapter(config);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });
  async function fail() {
    const pending = adapter.validate(input).catch((error: unknown) => error);
    await jest.runAllTimersAsync();
    const error = await pending;
    expect(error).toBeInstanceOf(AiValidatorError);
    return error as AiValidatorError;
  }

  it.each([429, 503])('obeys Retry-After on HTTP %i', async (status) => {
    const starts: number[] = [];
    jest.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      starts.push(Date.now());
      return response(status, '5');
    });
    const error = await fail();
    expect(starts.map((t) => t - starts[0])).toEqual([0, 5000, 10000]);
    expect(error.diagnostics).toMatchObject({
      attempts: 3,
      retriesExhausted: true,
      totalLatencyMs: 10000,
    });
  });
  it('obeys an HTTP date', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(response(503, 'Tue, 06 Oct 2026 00:00:05 GMT'));
    config.set('AI_MAX_RETRIES', 1);
    expect((await fail()).diagnostics?.totalLatencyMs).toBe(5000);
  });
  it.each(['31', '999999999999999999999999'])(
    'stops rather than shorten excessive Retry-After %s',
    async (header) => {
      const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(response(503, header));
      expect((await fail()).diagnostics).toMatchObject({
        attempts: 1,
        retriesExhausted: false,
        totalLatencyMs: 0,
        httpStatus: 503,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );
  it('enforces the cumulative retry delay budget', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(response(429, '20'));
    expect((await fail()).diagnostics).toMatchObject({
      attempts: 2,
      retriesExhausted: false,
      totalLatencyMs: 20000,
    });
  });
  it.each(['bad', '-1', 'Mon, 05 Oct 2026 00:00:00 GMT'])(
    'falls back for invalid Retry-After %s',
    async (header) => {
      jest.spyOn(globalThis, 'fetch').mockResolvedValue(response(503, header));
      expect((await fail()).diagnostics?.totalLatencyMs).toBe(3000);
    },
  );
  it.each([
    [[daily], 'DAILY_QUOTA', 1],
    [[minute], 'SHORT_WINDOW', 3],
    [['unknown'], 'UNKNOWN', 3],
  ])('uses safe quota evidence %j', async (ids, scope, attempts) => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(response(429, sensitive, quota(...(ids as string[]))));
    const error = await fail();
    expect(error.code).toBe('AI_PROVIDER_UNAVAILABLE');
    expect(error.message).toBe('AI provider is unavailable');
    expect(error.diagnostics).toMatchObject({
      rateLimitScope: scope,
      attempts,
      retriesExhausted: attempts === 3,
    });
    expect(fetchMock).toHaveBeenCalledTimes(attempts as number);
    const serialized = JSON.stringify({
      code: error.code,
      message: error.message,
      diagnostics: error.diagnostics,
    });
    expect(serialized).not.toContain(sensitive);
    for (const key of [
      'quotaId',
      'headers',
      'Retry-After',
      'sourceFiles',
      'targetFiles',
      'prompt',
      'body',
    ])
      expect(serialized).not.toContain(key);
  });
  it('keeps malformed error JSON as unknown 429', async () => {
    const bad = response(429);
    jest.mocked(bad.json).mockRejectedValue(new Error(sensitive));
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(bad);
    expect((await fail()).diagnostics).toMatchObject({
      finalFailureClass: 'RATE_LIMITED',
      rateLimitScope: 'UNKNOWN',
      attempts: 3,
    });
  });
  it('never retries daily quota even when Retry-After suggests a short wait', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(response(429, '1', quota(daily, minute)));
    expect((await fail()).diagnostics).toMatchObject({
      rateLimitScope: 'DAILY_QUOTA',
      attempts: 1,
      retriesExhausted: false,
      totalLatencyMs: 0,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('allows a wait exactly equal to the remaining retry budget', async () => {
    config.set('AI_MAX_RETRIES', 1);
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(response(503, '30'));
    expect((await fail()).diagnostics).toMatchObject({
      attempts: 2,
      retriesExhausted: true,
      totalLatencyMs: 30000,
    });
  });
  it.each([0, 13000])(
    'paces concurrent outbound attempts and retries with interval %i',
    async (interval) => {
      config.set('GEMINI_MIN_REQUEST_INTERVAL_MS', interval);
      config.set('AI_MAX_RETRIES', 1);
      const starts: number[] = [];
      jest.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        starts.push(Date.now());
        return response(500);
      });
      const pending = Promise.all([
        adapter.validate(input).catch((error) => error),
        adapter.validate(input).catch((error) => error),
      ]);
      await jest.runAllTimersAsync();
      const errors = (await pending) as AiValidatorError[];
      expect(starts.map((t) => t - starts[0])).toEqual(
        interval === 0 ? [0, 0, 1000, 1000] : [0, 13000, 26000, 39000],
      );
      expect(errors.map((error) => error.diagnostics?.attempts)).toEqual([2, 2]);
      expect(errors.every((error) => error.diagnostics?.retriesExhausted)).toBe(true);
    },
  );
  it('does not spend the HTTP timeout waiting for pacing', async () => {
    config.set('GEMINI_MIN_REQUEST_INTERVAL_MS', 13000);
    const success = response(200, undefined, {
      candidates: [{ content: { parts: [{ text: '{"findings":[]}' }] } }],
    });
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(success);
    const pending = Promise.all([adapter.validate(input), adapter.validate(input)]);
    await jest.runAllTimersAsync();
    expect(await pending).toEqual([{ findings: [] }, { findings: [] }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
