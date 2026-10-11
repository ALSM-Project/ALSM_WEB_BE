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
  organizationId?: string;
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
  organizationId: string;
  screenId: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  totalFindings: number;
  findingCount: number;
  openCount: number;
  confirmedCount: number;
  rejectedCount: number;
  resolvedCount: number;
  aiValidationEnabled: boolean;
  ruleValidationEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface LegacyValidationScope {
  organizationId: string;
  projectId: string;
  conversionJobId: string;
  screenId: string;
}

export interface ValidationRepository {
  createRun(
    input: Omit<ValidationRunRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ValidationRunRecord>;
  findRunByJob(scope: LegacyValidationScope): Promise<ValidationRunRecord | null>;
  findRunById(id: string, scope: LegacyValidationScope): Promise<ValidationRunRecord | null>;
  findFindingById(id: string, organizationId: string): Promise<ValidationFindingRecord | null>;
  createFindings(
    findings: Omit<ValidationFindingRecord, 'id' | 'createdAt' | 'updatedAt'>[],
  ): Promise<ValidationFindingRecord[]>;
  listFindingsByRun(
    validationRunId: string,
    scope: LegacyValidationScope,
  ): Promise<ValidationFindingRecord[]>;
  updateFindingStatus(
    id: string,
    status: FindingStatus,
    scope: LegacyValidationScope & { validationRunId: string },
    reviewedBy?: string,
    decision?: string,
  ): Promise<ValidationFindingRecord | null>;
}

export const VALIDATION_REPOSITORY = Symbol('VALIDATION_REPOSITORY');
