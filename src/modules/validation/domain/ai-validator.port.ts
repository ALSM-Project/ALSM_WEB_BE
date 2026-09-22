import {
  CodeLocation,
  ValidationFindingCategory,
  ValidationFindingSeverity,
} from './validation-finding.types';

export interface AiValidationCodeFile {
  path: string;
  /** Sanitized, provider-only content with stable one-based line prefixes. */
  content: string;
  /** Original source line count used to validate provider locations. */
  lineCount: number;
}

/**
 * Provider-neutral validation input. Future mapping, dependency, retrieval, and
 * instruction context can be added here without changing the validator boundary.
 */
export interface AiValidationInput {
  conversionJobId: string;
  sourceFiles: AiValidationCodeFile[];
  targetFiles: AiValidationCodeFile[];
}

export interface AiValidationFindingDraft {
  category: ValidationFindingCategory;
  severity: ValidationFindingSeverity;
  title: string;
  explanation: string;
  expectedBehavior?: string;
  actualBehavior?: string;
  suggestion?: string;
  sourceLocation?: CodeLocation;
  targetLocation?: CodeLocation;
  /** Advisory model confidence only; never a correctness score, proof, or review decision. */
  confidence?: number;
}

export interface AiValidationResult {
  findings: AiValidationFindingDraft[];
}

export interface AiValidatorMetadata {
  provider: string;
  model: string;
  promptVersion: string;
}

export interface AiValidatorPort {
  getMetadata(): AiValidatorMetadata;
  validate(input: AiValidationInput): Promise<AiValidationResult>;
}

export const AI_VALIDATOR = Symbol('AI_VALIDATOR');
