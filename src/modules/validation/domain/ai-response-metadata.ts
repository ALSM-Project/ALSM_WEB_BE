/** Internal, response-scoped metadata; non-enumerable and excluded from JSON contracts. */
export const AI_RESPONSE_METADATA = Symbol('AI_RESPONSE_METADATA');
export interface AiResponseMetadata {
  requestedModel: string;
  modelVersion?: string;
}
export interface WithAiResponseMetadata {
  [AI_RESPONSE_METADATA]?: Readonly<AiResponseMetadata>;
}

export function safeGeminiModelVersion(value: unknown): string | undefined {
  return typeof value === 'string' &&
    value.length <= 128 &&
    /^gemini-[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(value)
    ? value
    : undefined;
}

export function withAiResponseMetadata<T extends object>(
  value: T,
  requestedModel: string,
  reportedVersion: unknown,
): T & WithAiResponseMetadata {
  const modelVersion = safeGeminiModelVersion(reportedVersion);
  return Object.defineProperty(value, AI_RESPONSE_METADATA, {
    value: Object.freeze({ requestedModel, ...(modelVersion ? { modelVersion } : {}) }),
    enumerable: false,
  });
}
