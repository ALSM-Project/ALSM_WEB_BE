export type TransferRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface ResourceTransferRequestRecord {
  id: string;
  organizationId: string;
  projectId: string;
  projectName: string;
  currentAssigneeId?: string;
  currentAssigneeName?: string;
  targetAssigneeId: string;
  targetAssigneeName: string;
  targetAssigneeEmail?: string;
  requestedById: string;
  requestedByName: string;
  reason: string;
  note: string;
  status: TransferRequestStatus;
  reviewedById?: string;
  reviewedByName?: string;
  reviewedAt?: Date;
  reviewNote?: string;
  rejectionReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

export const RESOURCE_TRANSFER_REQUEST_REPOSITORY = 'RESOURCE_TRANSFER_REQUEST_REPOSITORY';

export interface ResourceTransferRequestRepository {
  create(
    input: Omit<ResourceTransferRequestRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ResourceTransferRequestRecord>;

  findById(id: string): Promise<ResourceTransferRequestRecord | null>;

  findAll(filter?: {
    organizationId?: string;
    projectId?: string;
    status?: TransferRequestStatus;
  }): Promise<ResourceTransferRequestRecord[]>;

  update(
    id: string,
    patch: Partial<ResourceTransferRequestRecord>,
  ): Promise<ResourceTransferRequestRecord | null>;
}
