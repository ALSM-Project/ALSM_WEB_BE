import { ConversionJobStatus } from './conversion-job.types';

export interface ConversionWorkloadPort {
  listAssignedJobs(input: {
    organizationId: string;
    projectId: string;
    jobIds: string[];
    start: Date;
    end: Date;
  }): Promise<{ id: string; status: ConversionJobStatus }[]>;
}
export const CONVERSION_WORKLOAD = Symbol('CONVERSION_WORKLOAD');
