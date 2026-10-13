import { buildAiValidationJsonSchema } from '../src/modules/validation/infrastructure/ai-validation-output.validator';
import { createGeminiValidationSchema } from '../src/modules/validation/infrastructure/gemini-validation-schema';

describe('createGeminiValidationSchema', () => {
  it.each([2, 50])('omits only findings.maxItems from the canonical schema with limit %i', (maxFindings) => {
    const canonical = buildAiValidationJsonSchema(maxFindings);
    const original = structuredClone(canonical);
    const gemini = createGeminiValidationSchema(canonical);

    expect(canonical).toStrictEqual(original);
    expect(canonical).toHaveProperty('properties.findings.maxItems', maxFindings);
    expect(gemini).not.toHaveProperty('properties.findings.maxItems');

    // Restoring the single omitted field must recover the entire canonical schema:
    // enums, anyOf nullability, additionalProperties, confidence bounds, required, and items.
    const restored = structuredClone(gemini);
    findingsSchema(restored).maxItems = maxFindings;
    expect(restored).toStrictEqual(original);
  });

  it('deep-clones the canonical schema so transport mutations cannot affect it', () => {
    const canonical = buildAiValidationJsonSchema(50);
    const original = structuredClone(canonical);
    const gemini = createGeminiValidationSchema(canonical);
    const geminiFindings = findingsSchema(gemini);
    const canonicalFindings = findingsSchema(canonical);

    expect(gemini).not.toBe(canonical);
    expect(gemini.properties).not.toBe(canonical.properties);
    expect(geminiFindings).not.toBe(canonicalFindings);
    expect(geminiFindings.items).not.toBe(canonicalFindings.items);

    const item = geminiFindings.items as Record<string, unknown>;
    const properties = item.properties as Record<string, unknown>;
    const confidence = properties.confidence as { anyOf: Record<string, unknown>[] };
    confidence.anyOf[0].maximum = 0.5;
    (item.required as string[]).pop();
    expect(canonical).toStrictEqual(original);
  });
});

function findingsSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const properties = schema.properties as Record<string, unknown>;
  return properties.findings as Record<string, unknown>;
}
