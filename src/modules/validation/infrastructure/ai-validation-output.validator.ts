import * as Joi from 'joi';
import {
  AiValidationFindingDraft,
  AiValidationInput,
} from '../domain/ai-validator.port';
import { AiValidatorError } from '../domain/ai-validator.error';
import {
  ValidationFindingCategory,
  ValidationFindingSeverity,
} from '../domain/validation-finding.types';

interface RawLocation {
  file: string;
  startLine: number;
  endLine: number;
}

interface RawFinding {
  category: ValidationFindingCategory;
  severity: ValidationFindingSeverity;
  title: string;
  explanation: string;
  expectedBehavior: string | null;
  actualBehavior: string | null;
  suggestion: string | null;
  sourceLocation: RawLocation | null;
  targetLocation: RawLocation | null;
  confidence: number | null;
}

interface RawOutput {
  findings: RawFinding[];
}

const locationJsonSchema = {
  type: 'object',
  properties: {
    file: { type: 'string' },
    startLine: { type: 'integer', minimum: 1 },
    endLine: { type: 'integer', minimum: 1 },
  },
  required: ['file', 'startLine', 'endLine'],
  additionalProperties: false,
};

export function buildAiValidationJsonSchema(maxFindings: number): Record<string, unknown> {
  const nullableText = { anyOf: [{ type: 'string' }, { type: 'null' }] };
  const nullableLocation = { anyOf: [locationJsonSchema, { type: 'null' }] };

  return {
    type: 'object',
    properties: {
      findings: {
        type: 'array',
        maxItems: maxFindings,
        items: {
          type: 'object',
          properties: {
            category: { type: 'string', enum: Object.values(ValidationFindingCategory) },
            severity: { type: 'string', enum: Object.values(ValidationFindingSeverity) },
            title: { type: 'string' },
            explanation: { type: 'string' },
            expectedBehavior: nullableText,
            actualBehavior: nullableText,
            suggestion: nullableText,
            sourceLocation: nullableLocation,
            targetLocation: nullableLocation,
            confidence: {
              anyOf: [
                { type: 'number', minimum: 0, maximum: 1 },
                { type: 'null' },
              ],
            },
          },
          required: [
            'category',
            'severity',
            'title',
            'explanation',
            'expectedBehavior',
            'actualBehavior',
            'suggestion',
            'sourceLocation',
            'targetLocation',
            'confidence',
          ],
          additionalProperties: false,
        },
      },
    },
    required: ['findings'],
    additionalProperties: false,
  };
}

export function validateAiValidationOutput(
  value: unknown,
  input: AiValidationInput,
  maxFindings: number,
): AiValidationFindingDraft[] {
  const location = Joi.object({
    file: Joi.string().min(1).required(),
    startLine: Joi.number().integer().min(1).required(),
    endLine: Joi.number().integer().min(1).required(),
  }).unknown(false);
  const nullableText = Joi.alternatives()
    .try(Joi.string().trim().min(1).max(4_000), Joi.valid(null))
    .required();
  const finding = Joi.object({
    category: Joi.string()
      .valid(...Object.values(ValidationFindingCategory))
      .required(),
    severity: Joi.string()
      .valid(...Object.values(ValidationFindingSeverity))
      .required(),
    title: Joi.string().trim().min(1).max(300).required(),
    explanation: Joi.string().trim().min(1).max(4_000).required(),
    expectedBehavior: nullableText,
    actualBehavior: nullableText,
    suggestion: nullableText,
    sourceLocation: Joi.alternatives().try(location, Joi.valid(null)).required(),
    targetLocation: Joi.alternatives().try(location, Joi.valid(null)).required(),
    confidence: Joi.alternatives()
      .try(Joi.number().min(0).max(1), Joi.valid(null))
      .required(),
  }).unknown(false);
  const schema = Joi.object({
    findings: Joi.array().items(finding).max(maxFindings).required(),
  }).unknown(false);
  const validation = schema.validate(value, { abortEarly: false, convert: false });

  if (validation.error) {
    throw invalidOutput();
  }

  const output = validation.value as RawOutput;
  return output.findings.map((raw) => ({
    category: raw.category,
    severity: raw.severity,
    title: raw.title,
    explanation: raw.explanation,
    ...(raw.expectedBehavior === null ? {} : { expectedBehavior: raw.expectedBehavior }),
    ...(raw.actualBehavior === null ? {} : { actualBehavior: raw.actualBehavior }),
    ...(raw.suggestion === null ? {} : { suggestion: raw.suggestion }),
    ...(raw.sourceLocation === null
      ? {}
      : { sourceLocation: validateLocation(raw.sourceLocation, input.sourceFiles) }),
    ...(raw.targetLocation === null
      ? {}
      : { targetLocation: validateLocation(raw.targetLocation, input.targetFiles) }),
    ...(raw.confidence === null ? {} : { confidence: raw.confidence }),
  }));
}

function validateLocation(
  location: RawLocation,
  files: AiValidationInput['sourceFiles'],
): RawLocation {
  const file = files.find((candidate) => candidate.path === location.file);
  if (
    !file ||
    location.endLine < location.startLine ||
    location.startLine > file.lineCount ||
    location.endLine > file.lineCount
  ) {
    throw invalidOutput();
  }
  return location;
}

function invalidOutput(): AiValidatorError {
  return new AiValidatorError(
    'AI_PROVIDER_RESPONSE_INVALID',
    'AI provider returned an invalid validation response',
  );
}
