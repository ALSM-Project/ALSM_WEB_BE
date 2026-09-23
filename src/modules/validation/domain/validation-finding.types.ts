export enum ValidationFindingSource {
  RULE = 'RULE',
  AI = 'AI',
  COMPILER = 'COMPILER',
  STATIC_ANALYSIS = 'STATIC_ANALYSIS',
  DIFFERENTIAL_TEST = 'DIFFERENTIAL_TEST',
}

export enum ValidationFindingCategory {
  DATA_TYPE_MISMATCH = 'DATA_TYPE_MISMATCH',
  LOGIC_MISMATCH = 'LOGIC_MISMATCH',
  VARIABLE_MAPPING_MISMATCH = 'VARIABLE_MAPPING_MISMATCH',
  CONTROL_FLOW_MISMATCH = 'CONTROL_FLOW_MISMATCH',
  FILE_IO_MISMATCH = 'FILE_IO_MISMATCH',
  DATABASE_MISMATCH = 'DATABASE_MISMATCH',
  ENCODING_MISMATCH = 'ENCODING_MISMATCH',
  MISSING_OPERATION = 'MISSING_OPERATION',
  UNSUPPORTED_CONSTRUCT = 'UNSUPPORTED_CONSTRUCT',
  POTENTIAL_BEHAVIOR_CHANGE = 'POTENTIAL_BEHAVIOR_CHANGE',
  OTHER = 'OTHER',
}

export enum ValidationFindingSeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export enum ValidationFindingStatus {
  PENDING = 'PENDING',
  NEEDS_CORRECTION = 'NEEDS_CORRECTION',
  MANUAL_REVIEW = 'MANUAL_REVIEW',
  NOT_APPLICABLE = 'NOT_APPLICABLE',
  RESOLVED = 'RESOLVED',
}

export interface CodeLocation {
  file?: string;
  startLine?: number;
  endLine?: number;
  snippet?: string;
}

export interface ValidationFindingRecord {
  id: string;
  organizationId: string;
  projectId: string;
  conversionJobId: string;
  validationRunId: string;
  screenId?: string;
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
  createdAt: Date;
  updatedAt: Date;
  reviewedBy?: string;
  reviewedAt?: Date;
  reviewNote?: string;
}
