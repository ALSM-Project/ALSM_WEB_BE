import { ValidationFindingRecord } from './validation-finding.types';

export type CreateValidationFindingInput = Omit<
  ValidationFindingRecord,
  'id' | 'createdAt' | 'updatedAt'
>;

export interface ValidationFindingRepository {
  create(input: CreateValidationFindingInput): Promise<ValidationFindingRecord>;
  createMany(inputs: CreateValidationFindingInput[]): Promise<ValidationFindingRecord[]>;
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
