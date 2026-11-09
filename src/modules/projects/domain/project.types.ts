export enum ConversionType {
  BMS_DSPF_TO_FRONTEND = 'BMS_DSPF_TO_FRONTEND',
  COBOL_TO_JAVA = 'COBOL_TO_JAVA',
}

export enum ManagedProjectStage {
  REQUIREMENTS_GATHERING = 'REQUIREMENTS_GATHERING',
  LEGACY_ANALYSIS = 'LEGACY_ANALYSIS',
  CONVERSION = 'CONVERSION',
  TESTING_VALIDATION = 'TESTING_VALIDATION',
  TEAM_LEAD_REVIEW = 'TEAM_LEAD_REVIEW',
  ADMIN_DELIVERY_REVIEW = 'ADMIN_DELIVERY_REVIEW',
  CUSTOMER_REVIEW = 'CUSTOMER_REVIEW',
  ACCEPTANCE = 'ACCEPTANCE',
  DELIVERY = 'DELIVERY',
}

export const MANAGED_PROJECT_STAGE_ORDER: ManagedProjectStage[] = [
  ManagedProjectStage.REQUIREMENTS_GATHERING,
  ManagedProjectStage.LEGACY_ANALYSIS,
  ManagedProjectStage.CONVERSION,
  ManagedProjectStage.TESTING_VALIDATION,
  ManagedProjectStage.TEAM_LEAD_REVIEW,
  ManagedProjectStage.ADMIN_DELIVERY_REVIEW,
  ManagedProjectStage.CUSTOMER_REVIEW,
  ManagedProjectStage.ACCEPTANCE,
  ManagedProjectStage.DELIVERY,
];

export const MANAGED_STAGE_METADATA: Record<
  ManagedProjectStage,
  { index: number; name: string; description: string }
> = {
  [ManagedProjectStage.REQUIREMENTS_GATHERING]: {
    index: 1,
    name: 'Requirements Gathering',
    description: 'Collecting and validating customer legacy files, specifications, and modernization goals.',
  },
  [ManagedProjectStage.LEGACY_ANALYSIS]: {
    index: 2,
    name: 'Legacy Analysis',
    description: 'Mainframe screen and COBOL syntax analysis, complexity scoring, and inventory breakdown.',
  },
  [ManagedProjectStage.CONVERSION]: {
    index: 3,
    name: 'Conversion',
    description: 'Transforming BMS/DSPF to modern TypeScript/React screens and COBOL to modern target architecture.',
  },
  [ManagedProjectStage.TESTING_VALIDATION]: {
    index: 4,
    name: 'Testing & Validation',
    description: 'Automated layout verification, visual regression testing, and data binding validation.',
  },
  [ManagedProjectStage.TEAM_LEAD_REVIEW]: {
    index: 5,
    name: 'Team Lead Review',
    description: 'Internal engineering review, code quality sign-off, and architectural validation.',
  },
  [ManagedProjectStage.ADMIN_DELIVERY_REVIEW]: {
    index: 6,
    name: 'Admin Delivery Review',
    description: 'Delivery readiness review by ALSM Admin before customer presentation.',
  },
  [ManagedProjectStage.CUSTOMER_REVIEW]: {
    index: 7,
    name: 'Customer Review',
    description: 'Customer sandbox preview, interactive screen inspection, and feedback collection.',
  },
  [ManagedProjectStage.ACCEPTANCE]: {
    index: 8,
    name: 'Acceptance',
    description: 'Formal deliverable review, customer sign-off, and acceptance recording.',
  },
  [ManagedProjectStage.DELIVERY]: {
    index: 9,
    name: 'Delivery',
    description: 'Final deployment bundle release, source code handover, and project completion.',
  },
};

export enum ProjectStatus {
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  PENDING_REVIEW = 'PENDING_REVIEW',
  APPROVED = 'APPROVED',
  READY_FOR_ASSIGNMENT = 'READY_FOR_ASSIGNMENT',
  ACTIVE = 'ACTIVE',
  IN_PROGRESS = 'IN_PROGRESS',
  AWAITING_CUSTOMER_REVIEW = 'AWAITING_CUSTOMER_REVIEW',
  AWAITING_ACCEPTANCE = 'AWAITING_ACCEPTANCE',
  NEEDS_INFO = 'NEEDS_INFO',
  REJECTED = 'REJECTED',
  /** The converted code bundle has been released to the partner (UC-48). */
  COMPLETED = 'COMPLETED',
  ARCHIVED = 'ARCHIVED',
}

export interface ProjectFileRecord {
  fileId: string;
  originalName: string;
  fileSize: number;
  mimeType?: string;
  category?: string;
  storageKey?: string;
  uploadedAt?: Date;
}

export interface ProjectAcceptanceRecord {
  accepted: boolean;
  acceptedBy: string;
  acceptedByName?: string;
  acceptedAt: Date;
  notes?: string;
}

export interface ProjectRecord {
  id: string;
  organizationId: string;
  name: string;
  description?: string;
  conversionType: ConversionType;
  status: ProjectStatus;
  createdBy: string;
  serviceType?: 'SELF_SERVICE' | 'MANAGED';
  conversionRequestId?: string;
  contractNumber?: string;
  contractId?: string;
  currentStage?: ManagedProjectStage;
  stageIndex?: number;
  progressPct?: number;
  submittedAt?: Date;
  submittedBy?: string;
  businessRequirements?: string;
  adminReviewNotes?: string;
  reviewedBy?: string;
  reviewedAt?: Date;
  isDemo?: boolean;
  assignedTeamLeadId?: string;
  assignedTeamLeadName?: string;
  teamLeadAssignedBy?: string;
  teamLeadAssignedByName?: string;
  teamLeadAssignedAt?: Date;
  teamLeadAssignmentNote?: string;
  teamLeadAssignmentStatus?: 'ASSIGNED' | 'ACCEPTED' | 'REASSIGNED';
  /** The Conversion Staff member the Team Lead allocated the project to (UC-86). */
  assignedStaffId?: string;
  assignedStaffName?: string;
  /** Technical briefing the Team Lead wrote when allocating. */
  staffAssignmentNote?: string;
  staffAssignedBy?: string;
  staffAssignedAt?: Date;
  files?: ProjectFileRecord[];
  acceptance?: ProjectAcceptanceRecord;
  isExported?: boolean;
  exportedAt?: Date;
  exportedBundleName?: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

export interface ProjectRepository {
  create(
    input: Omit<ProjectRecord, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
  ): Promise<ProjectRecord>;
  findById(id: string, organizationId?: string): Promise<ProjectRecord | null>;
  findAll(organizationId?: string): Promise<ProjectRecord[]>;
  update(
    id: string,
    organizationId: string,
    input: Partial<Pick<ProjectRecord, 'name' | 'description' | 'status' | 'assignedTeamLeadId' | 'currentStage' | 'stageIndex' | 'progressPct' | 'adminReviewNotes'>>,
  ): Promise<ProjectRecord | null>;
  assignTeamLead(
    id: string,
    assignment: {
      teamLeadId: string;
      teamLeadName?: string;
      assignedBy: string;
      assignedByName?: string;
      note?: string;
    },
  ): Promise<ProjectRecord | null>;
  updateStage(
    id: string,
    stage: ManagedProjectStage,
    stageIndex: number,
    progressPct: number,
    status?: ProjectStatus,
  ): Promise<ProjectRecord | null>;
  recordAcceptance(
    id: string,
    acceptance: ProjectAcceptanceRecord,
  ): Promise<ProjectRecord | null>;
  /** Projects a Team Lead allocated to this staff member (UC-86), optionally within one organization. */
  findByAssignedStaff(staffId: string, organizationId?: string): Promise<ProjectRecord[]>;
  assignStaff(
    id: string,
    staff: { staffId: string; staffName: string; note?: string; assignedBy: string },
  ): Promise<ProjectRecord | null>;
  removeStaff(id: string): Promise<ProjectRecord | null>;
  softDelete(id: string, organizationId: string): Promise<boolean>;
}

export const PROJECT_REPOSITORY = Symbol('PROJECT_REPOSITORY');
