export interface DepartingStaffDossier {
  id: string;
  fullName: string;
  email: string;
  isActive: boolean;
  isLocked: boolean;
  roles: string[];
}

export interface OffboardingAssignedProject {
  id: string;
  name: string;
  status: string;
  organizationId: string;
  assignedRole: 'CONVERSION_STAFF' | 'TEAM_LEAD' | 'OWNER';
  isTransferable: boolean;
}

export interface OffboardingActiveSession {
  id: string;
  deviceType?: string;
  browser?: string;
  ipAddress?: string;
  lastActiveAt?: Date;
  createdAt?: Date;
}

export interface OffboardingPendingJob {
  id: string;
  projectId: string;
  status: string;
  priority: string;
  conversionType: string;
}

export interface OffboardingEligibleSuccessor {
  id: string;
  fullName: string;
  email: string;
  roles: string[];
  activeWorkload: number;
}

export interface UserOffboardingSummary {
  user: DepartingStaffDossier;
  activeSessionsCount: number;
  activeSessions: OffboardingActiveSession[];
  apiCredentialsCount: number;
  assignedProjects: OffboardingAssignedProject[];
  pendingJobsCount: number;
  pendingJobs: OffboardingPendingJob[];
  eligibleStaff: OffboardingEligibleSuccessor[];
}

export interface OffboardingOperationResult {
  projectsTransferred: number;
  sessionsRevoked: number;
  apiCredentialsRevoked: number;
  rolesRemoved: number;
  accountDeactivated: boolean;
}

export interface UserOffboardingResult {
  success: boolean;
  message: string;
  user: {
    id: string;
    email: string;
    isActive: boolean;
    isLocked: boolean;
  };
  operations: OffboardingOperationResult;
  transferredProjects: Array<{
    projectId: string;
    projectName: string;
    previousOwnerId?: string;
    newOwnerId: string;
    newOwnerName: string;
  }>;
}
