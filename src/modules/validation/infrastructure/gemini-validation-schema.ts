/** Adapt the canonical ALSM schema for Gemini without changing the shared contract. */
export function createGeminiValidationSchema(canonicalSchema: Record<string, unknown>): Record<string, unknown> {
  const geminiSchema = structuredClone(canonicalSchema);
  const properties = geminiSchema.properties as Record<string, unknown>;
  const findings = properties.findings as Record<string, unknown>;

  // This constraint was rejected in the ALSM schema by Gemini. Runtime validation
  // still enforces maxFindings before the adapter returns any findings.
  delete findings.maxItems;
  return geminiSchema;
}
