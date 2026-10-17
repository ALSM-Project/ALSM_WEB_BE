export interface TeamJobAssignmentRecord {
  id: string;
  organizationId: string;
  teamId: string;
  projectId: string;
  jobId: string;
  memberId: string;
  assignedBy: string;
  assignedAt: Date;
  revokedAt?: Date | null;
  replayed?: boolean;
}
export interface TeamJobAssignmentRepository {
  findById(
    id: string,
    organizationId: string,
    teamId: string,
  ): Promise<TeamJobAssignmentRecord | null>;
  listActive(organizationId: string, teamId: string): Promise<TeamJobAssignmentRecord[]>;
  assign(
    input: Omit<TeamJobAssignmentRecord, 'id' | 'assignedAt' | 'revokedAt' | 'replayed'> & {
      assignmentId: string;
    },
  ): Promise<TeamJobAssignmentRecord | null>;
  revoke(
    organizationId: string,
    teamId: string,
    jobId: string,
    actorUserId: string,
    assignmentId: string,
  ): Promise<boolean>;
}
export const TEAM_JOB_ASSIGNMENTS = Symbol('TEAM_JOB_ASSIGNMENTS');
export interface WorkloadCounts {
  assignedJobs: number;
  processingJobs: number;
  completedJobs: number;
  failedJobs: number;
}
