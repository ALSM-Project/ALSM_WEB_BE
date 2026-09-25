import { ValidationFindingRecord } from './validation-finding.types';

export type CreateValidationFindingInput = Omit<
  ValidationFindingRecord,
  'id' | 'createdAt' | 'updatedAt'
>;

export interface UpsertValidationFindingInput extends CreateValidationFindingInput {
  /** Application-generated retry identity; never accepted from the AI provider or exposed by reads. */
  fingerprint: string;
}

export interface ReviewValidationFindingInput {
  findingId: string;
  validationRunId: string;
  projectId: string;
  organizationId: string;
  expectedStatus: ValidationFindingRecord['status'];
  newStatus: ValidationFindingRecord['status'];
  reviewedBy: string;
  reviewedAt: Date;
  reviewNote?: string;
}

export type ReviewValidationFindingResult =
  | { outcome: 'UPDATED'; finding: ValidationFindingRecord }
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'CONFLICT' };

export interface ValidationFindingRepository {
  create(input: CreateValidationFindingInput): Promise<ValidationFindingRecord>;
  createMany(inputs: CreateValidationFindingInput[]): Promise<ValidationFindingRecord[]>;
  upsertManyForRun(inputs: UpsertValidationFindingInput[]): Promise<void>;
  countByRun(validationRunId: string, projectId: string, organizationId: string): Promise<number>;
  findById(
    id: string,
    validationRunId: string,
    projectId: string,
    organizationId: string,
  ): Promise<ValidationFindingRecord | null>;
  reviewFinding(input: ReviewValidationFindingInput): Promise<ReviewValidationFindingResult>;
  listByRun(
    validationRunId: string,
    projectId: string,
    organizationId: string,
  ): Promise<ValidationFindingRecord[]>;
}

export const VALIDATION_FINDING_REPOSITORY = Symbol('VALIDATION_FINDING_REPOSITORY');
