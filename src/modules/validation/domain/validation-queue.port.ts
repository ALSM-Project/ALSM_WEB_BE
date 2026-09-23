export interface ValidationQueueJob {
  validationRunId: string;
  organizationId: string;
  projectId: string;
  conversionJobId: string;
}

export interface ValidationQueuePort {
  enqueue(job: ValidationQueueJob): Promise<void>;
}

export const VALIDATION_QUEUE = Symbol('VALIDATION_QUEUE');
