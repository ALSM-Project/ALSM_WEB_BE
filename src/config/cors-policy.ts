import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

// Origin is a scheme/authority tuple, never a URL path, userinfo or wildcard pattern.
const ORIGIN = /^https?:\/\/(?:\[[0-9a-f:.]+\]|[^:/?#\\\s*@%]+)(?::[0-9]+)?$/i;

function normalizeOrigin(value: string): string | null {
  if (/\s/.test(value) || !ORIGIN.test(value)) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function parseCorsOrigins(value: string | undefined): readonly string[] {
  if (typeof value !== 'string' || !value.trim())
    throw new Error('CORS_ORIGINS must contain explicit HTTP(S) origins');
  const origins = new Set<string>();
  for (const entry of value.split(',')) {
    const origin = normalizeOrigin(entry.trim());
    if (!origin) throw new Error('CORS_ORIGINS must contain only explicit HTTP(S) origins');
    origins.add(origin);
  }
  return [...origins];
}

export function createCorsOptions(value: string | undefined): CorsOptions {
  const allowed = new Set(parseCorsOrigins(value));
  return {
    origin: (requestOrigin, callback) => {
      const origin = requestOrigin === undefined ? null : normalizeOrigin(requestOrigin);
      // false skips CORS headers, not the API route or its existing authentication.
      callback(null, origin !== null && allowed.has(origin));
    },
    credentials: true,
  };
}
