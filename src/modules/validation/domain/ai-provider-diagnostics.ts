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

export interface AiProviderDiagnostics {
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
    finalFailureClass: value.finalFailureClass,
    ...(value.httpStatus === undefined ? {} : { httpStatus: value.httpStatus }),
    attempts: value.attempts,
    retriesExhausted: value.retriesExhausted,
    totalLatencyMs: value.totalLatencyMs,
  };
}
