export enum ConversionRequestStatus {
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  UNDER_REVIEW = 'UNDER_REVIEW',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  PROJECT_CREATED = 'PROJECT_CREATED',
  WITHDRAWN = 'WITHDRAWN',
}

export enum ManagedConversionPipeline {
  BMS_DSPF_TO_FRONTEND = 'BMS_DSPF_TO_FRONTEND',
  COBOL_TO_JAVA = 'COBOL_TO_JAVA',
  RPG_TO_FRONTEND = 'RPG_TO_FRONTEND',
}

export interface ConversionRequestFile {
  fileId: string;
  originalName: string;
  fileSize: number;
  mimeType: string;
  category: 'SOURCE_CODE' | 'SPECIFICATION' | 'DOCUMENTATION' | 'OTHER';
  uploadedAt: Date;
  storageKey?: string;
}

export interface ConversionRequestRecord {
  id: string;
  requestNumber: string;
  organizationId: string;
  organizationName?: string;
  contractNumber?: string;
  contractId?: string;
  projectName: string;
  projectDescription?: string;
  businessDomain?: string;
  businessRequirements?: string;
  pipeline: ManagedConversionPipeline;
  sourceTechnology: string;
  targetArchitecture: string;
  scope: {
    estimatedScreens?: number;
    estimatedPrograms?: number;
    estimatedLinesOfCode?: number;
    complexity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'ENTERPRISE';
  };
  contact: {
    name: string;
    email: string;
    phone?: string;
    role?: string;
  };
  specialInstructions?: string;
  expectedDeliverables?: string;
  preferredTimelineWeeks?: number;
  files: ConversionRequestFile[];
  status: ConversionRequestStatus;
  linkedProjectId?: string;
  reviewFeedback?: string;
  submittedAt?: Date;
  reviewedAt?: Date;
  reviewedBy?: string;
  projectCreatedAt?: Date;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}
