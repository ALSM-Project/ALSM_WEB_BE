export enum ValidationRunStatus {
  QUEUED = 'QUEUED',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export interface ValidationRunRecord {
  id: string;
  organizationId: string;
  projectId: string;
  conversionJobId: string;
  screenId?: string;
  status: ValidationRunStatus;
  ruleValidationEnabled: boolean;
  aiValidationEnabled: boolean;
  findingCount: number;
  provider?: string;
  model?: string;
  promptVersion?: string;
  redactionCount?: number;
  selectedFileCount?: number;
  inputCharacterCount?: number;
  expectedFindingCount?: number;
  resultsPersistedAt?: Date;
  failureCode?: string;
  failureMessage?: string;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
