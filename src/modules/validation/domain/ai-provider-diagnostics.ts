export const PROVIDER_FAILURE_CLASSES = [
  'RATE_LIMITED',
  'SERVER_ERROR',
  'TIMEOUT',
  'NETWORK_ERROR',
  'AUTHENTICATION_FAILED',
  'REQUEST_REJECTED',
  'REFUSED',
  'INVALID_OUTPUT',
] as const;

export const RATE_LIMIT_SCOPES = ['SHORT_WINDOW', 'DAILY_QUOTA', 'UNKNOWN'] as const;

export interface AiProviderDiagnostics {
  rateLimitScope?: (typeof RATE_LIMIT_SCOPES)[number];
  finalFailureClass: (typeof PROVIDER_FAILURE_CLASSES)[number];
  httpStatus?: number;
  attempts: number;
  retriesExhausted: boolean;
  totalLatencyMs: number;
}

// Copy only allowlisted primitives. Never serialize an arbitrary error or provider object.
export function sanitizeProviderDiagnostics(
  value: AiProviderDiagnostics,
): AiProviderDiagnostics | undefined {
  if (
    !PROVIDER_FAILURE_CLASSES.includes(value.finalFailureClass) ||
    (value.rateLimitScope !== undefined && !RATE_LIMIT_SCOPES.includes(value.rateLimitScope)) ||
    !Number.isInteger(value.attempts) ||
    value.attempts < 1 ||
    value.attempts > 6 ||
    typeof value.retriesExhausted !== 'boolean' ||
    !Number.isInteger(value.totalLatencyMs) ||
    value.totalLatencyMs < 0 ||
    (value.httpStatus !== undefined &&
      (!Number.isInteger(value.httpStatus) || value.httpStatus < 100 || value.httpStatus > 599))
  )
    return undefined;
  return {
    ...(value.rateLimitScope === undefined ? {} : { rateLimitScope: value.rateLimitScope }),
    finalFailureClass: value.finalFailureClass,
    ...(value.httpStatus === undefined ? {} : { httpStatus: value.httpStatus }),
    attempts: value.attempts,
    retriesExhausted: value.retriesExhausted,
    totalLatencyMs: value.totalLatencyMs,
  };
}
