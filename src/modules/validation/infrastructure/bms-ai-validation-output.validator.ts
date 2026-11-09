import * as Joi from 'joi';
import { AiValidationInput } from '../domain/ai-validator.port';
import { AiValidatorError } from '../domain/ai-validator.error';
import { BmsValidationCategory, BmsValidationFinding } from '../domain/bms-validation-taxonomy';
import {
  ValidationFindingCategory,
  ValidationFindingSeverity,
} from '../domain/validation-finding.types';
import { validateAiValidationOutput } from './ai-validation-output.validator';

/** Preserve BMS's field contract while sharing canonical bounds and location validation. */
export function validateBmsAiValidationOutput(
  value: unknown,
  input: AiValidationInput,
  maxFindings: number,
): BmsValidationFinding[] {
  const text = Joi.string().trim().min(1).max(4_000);
  const location = Joi.object({
    file: Joi.string().min(1).required(),
    startLine: Joi.number().integer().min(1).required(),
    endLine: Joi.number().integer().min(1).required(),
    snippet: text,
  }).unknown(false);
  const finding = Joi.object({
    findingId: Joi.string().min(1).max(128),
    category: Joi.string()
      .valid(...Object.values(BmsValidationCategory))
      .required(),
    severity: Joi.string()
      .valid(...Object.values(ValidationFindingSeverity))
      .required(),
    fieldName: Joi.string().trim().min(1).max(250).required(),
    sourceLocation: location.required(),
    targetLocation: location.required(),
    explanation: text.required(),
    suggestion: text.required(),
    expectedBehavior: text,
    actualBehavior: text,
    confidence: Joi.number().min(0).max(1),
  }).unknown(false);
  const checked = Joi.object({
    findings: Joi.array().items(finding).max(maxFindings).required(),
  })
    .unknown(false)
    .validate(value, { convert: false, abortEarly: false });
  if (checked.error) {
    throw new AiValidatorError(
      'AI_PROVIDER_RESPONSE_INVALID',
      'AI provider returned an invalid validation response',
    );
  }
  const output = checked.value as { findings: BmsValidationFinding[] };
  validateAiValidationOutput(
    {
      findings: output.findings.map((item) => ({
        category: ValidationFindingCategory[item.category],
        severity: item.severity,
        title: `[${item.category}] ${item.fieldName}`,
        explanation: item.explanation,
        expectedBehavior: item.expectedBehavior ?? null,
        actualBehavior: item.actualBehavior ?? null,
        suggestion: item.suggestion,
        sourceLocation: locationWithoutSnippet(item.sourceLocation),
        targetLocation: locationWithoutSnippet(item.targetLocation),
        confidence: item.confidence ?? null,
      })),
    },
    input,
    maxFindings,
    Object.values(BmsValidationCategory).map((category) => ValidationFindingCategory[category]),
  );
  return output.findings;
}

function locationWithoutSnippet({
  file,
  startLine,
  endLine,
}: BmsValidationFinding['sourceLocation']) {
  return { file, startLine, endLine };
}
