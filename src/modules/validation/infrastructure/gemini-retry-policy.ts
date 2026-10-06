import { AiProviderDiagnostics } from '../domain/ai-provider-diagnostics';

export const GEMINI_RETRY_WAIT_BUDGET_MS = 30_000;
export const GEMINI_MAX_BACKOFF_MS = 8_000;

// Positive jitter keeps the first wait near one second; truncation caps the whole wait.
export function geminiBackoffMs(attempt: number, random = Math.random()): number {
  return Math.min(GEMINI_MAX_BACKOFF_MS, Math.floor(1000 * 2 ** attempt * (1 + random * 0.25)));
}

// Accept HTTP dates only, not the permissive ISO/numeric formats accepted by Date.parse.
export function retryAfterMs(raw: string | null, now: number): number | undefined {
  if (raw === null) return undefined;
  const value = raw.trim();
  if (/^\d+$/.test(value)) {
    const milliseconds = Number(value) * 1000;
    return Number.isFinite(milliseconds) ? milliseconds : undefined;
  }
  const months = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
  const weekdays = 'Sun Mon Tue Wed Thu Fri Sat'.split(' ');
  const longDays = 'Sunday Monday Tuesday Wednesday Thursday Friday Saturday'.split(' ');
  let match =
    /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat), (\d{2}) ([A-Z][a-z]{2}) (\d{4}) (\d{2}:\d{2}:\d{2}) GMT$/.exec(
      value,
    );
  let day: string, month: string, year: number, time: string, weekday: number;
  if (match) {
    [, , day, month, , time] = match;
    year = Number(match[4]);
    weekday = weekdays.indexOf(match[1]);
  } else {
    match =
      /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday), (\d{2})-([A-Z][a-z]{2})-(\d{2}) (\d{2}:\d{2}:\d{2}) GMT$/.exec(
        value,
      );
    if (match) {
      [, , day, month, , time] = match;
      const currentYear = new Date(now).getUTCFullYear();
      year = Math.floor(currentYear / 100) * 100 + Number(match[4]);
      if (year > currentYear + 50) year -= 100;
      weekday = longDays.indexOf(match[1]);
    } else {
      match =
        /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) ([A-Z][a-z]{2}) ( \d|\d{2}) (\d{2}:\d{2}:\d{2}) (\d{4})$/.exec(
          value,
        );
      if (!match) return undefined;
      [, , month, day, time] = match;
      year = Number(match[5]);
      weekday = weekdays.indexOf(match[1]);
    }
  }
  const [hour, minute, second] = time.split(':').map(Number);
  const monthIndex = months.indexOf(month);
  const date = new Date(0);
  date.setUTCFullYear(year, monthIndex, Number(day));
  date.setUTCHours(hour, minute, second, 0);
  if (
    monthIndex < 0 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== monthIndex ||
    date.getUTCDate() !== Number(day) ||
    date.getUTCDay() !== weekday ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  )
    return undefined;
  const wait = date.getTime() - now;
  return Number.isFinite(wait) && wait >= 0 ? wait : undefined;
}

type Scope = NonNullable<AiProviderDiagnostics['rateLimitScope']>;
const quotaScopes = new Map<string, Scope>([
  ['GenerateRequestsPerDayPerProjectPerModel-FreeTier', 'DAILY_QUOTA'],
  ['GenerateRequestsPerDayPerProjectPerModel', 'DAILY_QUOTA'],
  ['GenerateContentInputTokensPerModelPerDay-FreeTier', 'DAILY_QUOTA'],
  ['GenerateRequestsPerMinutePerProjectPerModel-FreeTier', 'SHORT_WINDOW'],
  ['GenerateContentInputTokensPerModelPerMinute-FreeTier', 'SHORT_WINDOW'],
]);

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

// Inspect only typed quota violations. Never inspect message/description text or retain the body.
export function geminiRateLimitScope(body: unknown): Scope {
  const error = record(record(body)?.error);
  if (error?.status !== 'RESOURCE_EXHAUSTED' || !Array.isArray(error.details)) return 'UNKNOWN';
  const scopes: Scope[] = [];
  for (const detail of error.details) {
    const quota = record(detail);
    if (quota?.['@type'] !== 'type.googleapis.com/google.rpc.QuotaFailure') continue;
    if (!Array.isArray(quota.violations) || quota.violations.length === 0) scopes.push('UNKNOWN');
    else
      for (const value of quota.violations) {
        const id = record(value)?.quotaId;
        scopes.push(typeof id === 'string' ? (quotaScopes.get(id) ?? 'UNKNOWN') : 'UNKNOWN');
      }
  }
  if (scopes.includes('DAILY_QUOTA')) return 'DAILY_QUOTA';
  return scopes.length > 0 && scopes.every((scope) => scope === 'SHORT_WINDOW')
    ? 'SHORT_WINDOW'
    : 'UNKNOWN';
}
