export type DeliverableStatus =
  | 'DRAFT'
  | 'IN_REVIEW'
  | 'APPROVED'
  | 'PUBLISHED'
  | 'READY_FOR_REVIEW'
  | 'REVISION_REQUESTED';

export type DeliverablePackageType =
  | 'FULL_MODERNIZATION_PACKAGE'
  | 'FRONTEND_COMPONENTS'
  | 'BACKEND_SERVICES'
  | 'VALIDATION_REPORT'
  | 'TECHNICAL_REPORT'
  | 'REVIEW_REPORT';

export interface DeliverableCustomerReview {
  decision: 'APPROVED' | 'REVISION_REQUESTED';
  reviewedByUserId: string;
  reviewedByUserName: string;
  reviewedAt: Date;
  feedbackNotes?: string;
}

export interface DeliverableTeamLeadReview {
  decision: 'APPROVED' | 'REVISION_REQUESTED';
  reviewedByUserId: string;
  reviewedByUserName: string;
  reviewedAt: Date;
  feedbackNotes?: string;
}

export interface DeliverableRecord {
  id: string;
  projectId: string;
  projectName: string;
  organizationId: string;
  version: string;
  title: string;
  description: string;
  packageType: DeliverablePackageType;
  fileCount: number;
  totalSizeFormatted: string;
  downloadUrl?: string;
  status: DeliverableStatus;
  uploadedByUserId?: string;
  uploadedByName?: string;
  uploadedByRole?: string;
  teamLeadReview?: DeliverableTeamLeadReview;
  publishedAt?: Date;
  publishedBy?: string;
  publishedByName?: string;
  customerReview?: DeliverableCustomerReview;
  createdAt: Date;
  updatedAt: Date;
}
