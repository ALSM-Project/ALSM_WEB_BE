import {
  ValidationFindingCategory,
  ValidationFindingSeverity,
} from '../../../src/modules/validation/domain/validation-finding.types';

export const EVALUATOR_VERSION = '1.0.0';
export const MATCHING_POLICY_VERSION = '1.0.0';
export const DEFAULT_LOCATION_TOLERANCE_LINES = 2;

export const EVALUATION_CATEGORIES = [
  ValidationFindingCategory.DATA_TYPE_MISMATCH,
  ValidationFindingCategory.VARIABLE_MAPPING_MISMATCH,
  ValidationFindingCategory.LOGIC_MISMATCH,
  ValidationFindingCategory.CONTROL_FLOW_MISMATCH,
  ValidationFindingCategory.FILE_IO_MISMATCH,
  ValidationFindingCategory.DATABASE_MISMATCH,
  ValidationFindingCategory.ENCODING_MISMATCH,
  ValidationFindingCategory.MISSING_OPERATION,
  ValidationFindingCategory.UNSUPPORTED_CONSTRUCT,
  ValidationFindingCategory.POTENTIAL_BEHAVIOR_CHANGE,
] as const;

export type EvaluationCategory = (typeof EVALUATION_CATEGORIES)[number];
export type EvaluationDifficulty = 'EASY' | 'MEDIUM' | 'HARD';
export type EvaluationCaseStatus =
  | 'SUCCESS'
  | 'VALIDATION_FAILED'
  | 'PROVIDER_FAILED'
  | 'INVALID_OUTPUT';

export interface EvaluationCodeFile {
  path: string;
  content: string;
}

export interface EvaluationLocation {
  file: string;
  startLine: number;
  endLine: number;
}

export interface ExpectedEvaluationFinding {
  findingId: string;
  category: EvaluationCategory;
  acceptedCategories?: EvaluationCategory[];
  acceptedCategoryJustification?: string;
  severity: ValidationFindingSeverity;
  sourceLocation?: EvaluationLocation;
  targetLocation?: EvaluationLocation;
  allowCategoryOnly?: boolean;
  description: string;
  mutationId?: string;
}

export interface EvaluationMutation {
  mutationId: string;
  operator: string;
  description: string;
  observableImpact: string;
}

export interface AiEvaluationCase {
  caseId: string;
  title: string;
  description: string;
  sourceFiles: EvaluationCodeFile[];
  targetFiles: EvaluationCodeFile[];
  expectedFindings: ExpectedEvaluationFinding[];
  isClean: boolean;
  difficulty: EvaluationDifficulty;
  mutations?: EvaluationMutation[];
  tags: string[];
}

export interface AiEvaluationDataset {
  datasetId: string;
  version: string;
  type: 'synthetic-curated';
  description: string;
  caseCount: number;
  creationMethodology: string;
  limitations: string[];
  cases: AiEvaluationCase[];
}

export interface PredictedEvaluationFinding {
  category: EvaluationCategory;
  severity: ValidationFindingSeverity;
  title: string;
  explanation: string;
  sourceLocation?: EvaluationLocation;
  targetLocation?: EvaluationLocation;
  confidence?: number;
}

export interface EvaluationPredictionCase {
  caseId: string;
  status: EvaluationCaseStatus;
  latencyMs?: number;
  findings?: PredictedEvaluationFinding[];
  failure?: {
    code: string;
    message: string;
  };
}

export interface AiEvaluationPredictions {
  datasetId: string;
  datasetVersion: string;
  evaluatorVersion: string;
  generatedAt: string;
  provider: string;
  model: string;
  promptVersion: string;
  locationToleranceLines: number;
  matchingPolicyVersion: string;
  cases: EvaluationPredictionCase[];
}
