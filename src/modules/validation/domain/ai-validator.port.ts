import {
  CodeLocation,
  ValidationFindingCategory,
  ValidationFindingSeverity,
  ValidationFindingSource,
  ValidationFindingStatus,
} from './validation-finding.types';

export interface AiValidationCodeFile {
  path: string;
  content: string;
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
  source: ValidationFindingSource;
  category: ValidationFindingCategory;
  severity: ValidationFindingSeverity;
  status: ValidationFindingStatus;
  title: string;
  explanation: string;
  expectedBehavior?: string;
  actualBehavior?: string;
  suggestion?: string;
  sourceLocation?: CodeLocation;
  targetLocation?: CodeLocation;
  /** Advisory model confidence only; never a correctness score, proof, or review decision. */
  confidence?: number;
  modelProvider?: string;
  modelName?: string;
}

export interface AiValidationResult {
  findings: AiValidationFindingDraft[];
}

export interface AiValidatorPort {
  validate(input: AiValidationInput): Promise<AiValidationResult>;
}

export const AI_VALIDATOR = Symbol('AI_VALIDATOR');
