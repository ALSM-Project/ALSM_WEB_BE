export type OffboardingRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface ProjectTransferItem {
  projectId: string;
  projectName?: string;
  targetStaffId: string;
  targetStaffName?: string;
  reason?: string;
}

export interface OffboardingRequestRecord {
  id: string;
  organizationId: string;
  teamId?: string;
  teamName?: string;
  targetUserId: string;
  targetUserName: string;
  targetUserEmail: string;
  targetUserRoles: string[];
  requestedById: string;
  requestedByName: string;
  requestedByEmail?: string;
  transferToUserId?: string;
  transferToUserName?: string;
  projectTransfers?: ProjectTransferItem[];
  reason: string;
  note?: string;
  status: OffboardingRequestStatus;
  reviewedById?: string;
  reviewedByName?: string;
  reviewedAt?: Date;
  reviewNote?: string;
  rejectionReason?: string;
  executionResult?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export const OFFBOARDING_REQUEST_REPOSITORY = 'OFFBOARDING_REQUEST_REPOSITORY';

export interface IOffboardingRequestRepository {
  create(
    input: Omit<OffboardingRequestRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<OffboardingRequestRecord>;

  findById(id: string): Promise<OffboardingRequestRecord | null>;

  findPendingByTargetUser(targetUserId: string): Promise<OffboardingRequestRecord | null>;

  findAll(filter?: {
    organizationId?: string;
    teamId?: string;
    targetUserId?: string;
    requestedById?: string;
    status?: OffboardingRequestStatus;
  }): Promise<OffboardingRequestRecord[]>;

  update(
    id: string,
    patch: Partial<OffboardingRequestRecord>,
  ): Promise<OffboardingRequestRecord | null>;
}
