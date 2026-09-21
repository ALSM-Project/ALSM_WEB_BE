import { ValidationRunRecord } from './validation-run.types';

export type CreateValidationRunInput = Omit<ValidationRunRecord, 'id' | 'createdAt' | 'updatedAt'>;

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
}

export const VALIDATION_RUN_REPOSITORY = Symbol('VALIDATION_RUN_REPOSITORY');
