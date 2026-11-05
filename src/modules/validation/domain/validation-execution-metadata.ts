export enum ValidationExecutionOutcome {
  AI_COMPLETED = 'AI_COMPLETED',
  HEURISTIC_FALLBACK = 'HEURISTIC_FALLBACK',
  HEURISTIC_ONLY = 'HEURISTIC_ONLY',
}

/** Requested provider/model stay on the run; these fields describe the result producer. */
export interface ValidationExecutionMetadata {
  executionOutcome?: ValidationExecutionOutcome;
  resultProvider?: string;
  /** Model identifier sent on the successful request, or the deterministic rule identifier. */
  resultModel?: string;
  /** Safe provider self-report, never inferred from the requested model. */
  modelVersion?: string;
  providerFailureCode?: string;
}

export interface AiValidationExecution {
  outcome: ValidationExecutionOutcome;
  provider: string;
  model: string;
  providerFailureCode?: string;
}
