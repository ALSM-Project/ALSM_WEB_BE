import { ValidationRunRecord } from './validation-run.types';

export type CreateValidationRunInput = Omit<ValidationRunRecord, 'id' | 'createdAt' | 'updatedAt'>;

export interface CreateOrGetActiveValidationRunResult {
  run: ValidationRunRecord;
  created: boolean;
}

export interface CompleteValidationRunInput {
  findingCount: number;
  redactionCount: number;
  selectedFileCount: number;
  inputCharacterCount: number;
}

export interface PersistValidationResultsInput extends CompleteValidationRunInput {
  resultsPersistedAt: Date;
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
  createOrGetActiveAiRun(
    input: CreateValidationRunInput,
  ): Promise<CreateOrGetActiveValidationRunResult>;
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
  markProcessing(
    id: string,
    projectId: string,
    organizationId: string,
  ): Promise<ValidationRunRecord | null>;
  markResultsPersisted(
    id: string,
    projectId: string,
    organizationId: string,
    input: PersistValidationResultsInput,
  ): Promise<boolean>;
  markCompleted(
    id: string,
    projectId: string,
    organizationId: string,
    input: CompleteValidationRunInput,
  ): Promise<boolean>;
  markFailed(
    id: string,
    projectId: string,
    organizationId: string,
    input: FailValidationRunInput,
  ): Promise<void>;
}

export const VALIDATION_RUN_REPOSITORY = Symbol('VALIDATION_RUN_REPOSITORY');
