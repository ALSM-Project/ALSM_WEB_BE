export enum FindingSeverity {
  CRITICAL = 'CRITICAL',
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
  INFO = 'INFO',
}

export enum FindingStatus {
  OPEN = 'OPEN',
  CONFIRMED = 'CONFIRMED',
  REJECTED = 'REJECTED',
  RESOLVED = 'RESOLVED',
}

export enum ValidatorType {
  RULE_VALIDATOR = 'RULE_VALIDATOR',
  STATIC_ANALYSIS = 'STATIC_ANALYSIS',
  BEHAVIORAL_TEST = 'BEHAVIORAL_TEST',
  AI_VALIDATOR = 'AI_VALIDATOR',
}

export interface ValidationFindingRecord {
  id: string;
  conversionJobId: string;
  validationRunId: string;
  projectId: string;
  screenId: string;
  source: string;
  validatorType: ValidatorType;
  issueType: string;
  severity: FindingSeverity;
  sourceLocation: string;
  targetLocation: string;
  expectedBehavior: string;
  actualBehavior: string;
  explanation: string;
  suggestion: string;
  status: FindingStatus;
  confidence?: number;
  reviewDecision?: string;
  reviewedBy?: string;
  reviewedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ValidationRunRecord {
  id: string;
  conversionJobId: string;
  projectId: string;
  screenId: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  totalFindings: number;
  openCount: number;
  confirmedCount: number;
  rejectedCount: number;
  resolvedCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ValidationRepository {
  createRun(input: Omit<ValidationRunRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<ValidationRunRecord>;
  findRunByJob(conversionJobId: string): Promise<ValidationRunRecord | null>;
  createFindings(findings: Omit<ValidationFindingRecord, 'id' | 'createdAt' | 'updatedAt'>[]): Promise<ValidationFindingRecord[]>;
  listFindingsByRun(validationRunId: string): Promise<ValidationFindingRecord[]>;
  listFindingsByJob(conversionJobId: string): Promise<ValidationFindingRecord[]>;
  updateFindingStatus(id: string, status: FindingStatus, reviewedBy?: string, decision?: string): Promise<ValidationFindingRecord | null>;
}

export const VALIDATION_REPOSITORY = Symbol('VALIDATION_REPOSITORY');
