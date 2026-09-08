import { ConversionType } from '../../projects/domain/project.types';
export enum ConversionJobStatus {
  QUEUED = 'QUEUED',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  DEAD = 'DEAD',
  CANCELLED = 'CANCELLED',
}
export enum ConversionPriority {
  HIGH = 'HIGH',
  NORMAL = 'NORMAL',
  LOW = 'LOW',
}
export interface ConversionJobRecord {
  id: string;
  organizationId: string;
  projectId: string;
  screenId?: string;
  conversionType: ConversionType;
  status: ConversionJobStatus;
  priority: ConversionPriority;
  attemptCount: number;
  maxAttempts: number;
  inputReference?: string;
  resultReference?: string;
  errorCode?: string;
  errorMessage?: string;
  toolVersion?: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}
export interface ConversionJobRepository {
  create(
    input: Omit<ConversionJobRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ConversionJobRecord>;
  findById(id: string, organizationId: string): Promise<ConversionJobRecord | null>;
  findByIdAnyOrganization(id: string): Promise<ConversionJobRecord | null>;
  listByProject(projectId: string, organizationId: string): Promise<ConversionJobRecord[]>;
  listByScreen(
    projectId: string,
    screenId: string,
    organizationId: string,
  ): Promise<ConversionJobRecord[]>;
  retry(id: string, organizationId: string): Promise<ConversionJobRecord | null>;
  markProcessing(id: string): Promise<ConversionJobRecord | null>;
  markFailed(id: string, code: string, message: string): Promise<void>;
}
export const CONVERSION_JOB_REPOSITORY = Symbol('CONVERSION_JOB_REPOSITORY');
export interface ConversionQueuePort {
  enqueue(conversionJobId: string, priority: ConversionPriority): Promise<void>;
}
export const CONVERSION_QUEUE = Symbol('CONVERSION_QUEUE');
export interface ConversionEngineInput {
  conversionJobId: string;
  projectId: string;
  inputReference?: string;
  conversionType: ConversionType;
}
export interface ConversionEngineOutput {
  resultReference: string;
  toolVersion?: string;
}
export interface ConversionEnginePort {
  execute(input: ConversionEngineInput): Promise<ConversionEngineOutput>;
}
export const CONVERSION_ENGINE = Symbol('CONVERSION_ENGINE');
