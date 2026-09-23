import { ValidationFindingRecord } from './validation-finding.types';

export type CreateValidationFindingInput = Omit<
  ValidationFindingRecord,
  'id' | 'createdAt' | 'updatedAt'
>;

export interface UpsertValidationFindingInput extends CreateValidationFindingInput {
  /** Application-generated retry identity; never accepted from the AI provider or exposed by reads. */
  fingerprint: string;
}

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
  listByRun(
    validationRunId: string,
    projectId: string,
    organizationId: string,
  ): Promise<ValidationFindingRecord[]>;
}

export const VALIDATION_FINDING_REPOSITORY = Symbol('VALIDATION_FINDING_REPOSITORY');
