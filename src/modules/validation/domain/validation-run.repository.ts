import { ValidationRunRecord } from './validation-run.types';

export type CreateValidationRunInput = Omit<ValidationRunRecord, 'id' | 'createdAt' | 'updatedAt'>;

export interface CompleteValidationRunInput {
  findingCount: number;
  redactionCount: number;
  selectedFileCount: number;
  inputCharacterCount: number;
}

export interface FailValidationRunInput {
  failureCode: string;
  failureMessage: string;
  redactionCount?: number;
  selectedFileCount?: number;
  inputCharacterCount?: number;
}

export interface ValidationRunRepository {
  create(input: CreateValidationRunInput): Promise<ValidationRunRecord>;
  findById(
    id: string,
    projectId: string,
    organizationId: string,
  ): Promise<ValidationRunRecord | null>;
  listByConversionJob(
    conversionJobId: string,
    projectId: string,
    organizationId: string,
  ): Promise<ValidationRunRecord[]>;
  markCompleted(
    id: string,
    projectId: string,
    organizationId: string,
    input: CompleteValidationRunInput,
  ): Promise<void>;
  markFailed(
    id: string,
    projectId: string,
    organizationId: string,
    input: FailValidationRunInput,
  ): Promise<void>;
}

export const VALIDATION_RUN_REPOSITORY = Symbol('VALIDATION_RUN_REPOSITORY');
