export enum ConsultationType {
  SALES_SERVICE = 'SALES_SERVICE',
  LEGACY_MODERNIZATION = 'LEGACY_MODERNIZATION',
  TECHNICAL = 'TECHNICAL',
  ENTERPRISE_ARCHITECTURE = 'ENTERPRISE_ARCHITECTURE',
  CUSTOM_REQUIREMENTS = 'CUSTOM_REQUIREMENTS',
  CONTRACT_PACKAGE = 'CONTRACT_PACKAGE',
}

export interface ConsultationTypeConfig {
  key: ConsultationType;
  label: string;
  description: string;
  recommendedDurationMinutes: number;
}

export const CONSULTATION_TYPES_CATALOG: ConsultationTypeConfig[] = [
  {
    key: ConsultationType.SALES_SERVICE,
    label: 'Sales & Service Consultation',
    description: 'Exploration of ALSM modernization services, engagement models, and commercial overview.',
    recommendedDurationMinutes: 45,
  },
  {
    key: ConsultationType.LEGACY_MODERNIZATION,
    label: 'Legacy System Modernization Consultation',
    description: 'Deep dive into legacy BMS 3270 / AS400 DSPF screen inventories and COBOL backend migration.',
    recommendedDurationMinutes: 60,
  },
  {
    key: ConsultationType.TECHNICAL,
    label: 'Technical Consultation',
    description: 'Deterministic AST parsing engine, React 19 / Java 21 Spring Boot code generation, and validation rules.',
    recommendedDurationMinutes: 60,
  },
  {
    key: ConsultationType.ENTERPRISE_ARCHITECTURE,
    label: 'Enterprise Architecture Consultation',
    description: 'VPC deployment, SSO/RBAC enterprise governance, and legacy system integration patterns.',
    recommendedDurationMinutes: 60,
  },
  {
    key: ConsultationType.CUSTOM_REQUIREMENTS,
    label: 'Custom Enterprise Requirements',
    description: 'Tailored dialect support, custom AST transforms, proprietary UI component libraries, and SLAs.',
    recommendedDurationMinutes: 90,
  },
  {
    key: ConsultationType.CONTRACT_PACKAGE,
    label: 'Contract & Service Package Consultation',
    description: 'Commercial contract structure, volume screen bundles, support agreements, and MSA terms.',
    recommendedDurationMinutes: 45,
  },
];

export enum MeetingRequestStatus {
  NEW_REQUEST = 'NEW_REQUEST',
  PENDING_SCHEDULING = 'PENDING_SCHEDULING',
  SCHEDULED = 'SCHEDULED',
  CONFIRMED = 'CONFIRMED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  RESCHEDULE_REQUESTED = 'RESCHEDULE_REQUESTED',
  CANCELLED = 'CANCELLED',
  NO_SHOW = 'NO_SHOW',
}

export enum MeetingPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  URGENT = 'URGENT',
}

export enum CustomerType {
  PROSPECT = 'PROSPECT',
  EXISTING_CUSTOMER = 'EXISTING_CUSTOMER',
  PARTNER = 'PARTNER',
}

export enum MeetingFormat {
  GOOGLE_MEET = 'GOOGLE_MEET',
  TEAMS = 'TEAMS',
  ZOOM = 'ZOOM',
  PHONE = 'PHONE',
  IN_PERSON = 'IN_PERSON',
}

export interface ProposedSlot {
  slotId: string;
  startTime: Date;
  endTime: Date;
  proposedBy: string;
  proposedAt: Date;
  status: 'PROPOSED' | 'ACCEPTED' | 'DECLINED';
}

export interface MeetingInternalNote {
  id: string;
  authorId: string;
  authorName: string;
  content: string;
  createdAt: Date;
}

export interface MeetingCommunicationLog {
  id: string;
  channel: 'EMAIL' | 'PHONE' | 'SYSTEM';
  sender: string;
  recipient: string;
  subject?: string;
  content: string;
  sentAt: Date;
}

export interface MeetingHistoryEntry {
  action: string;
  performedBy: string;
  timestamp: Date;
  details?: string;
}

export interface MeetingOutcome {
  summary?: string;
  qualificationScore?: number;
  nextSteps?: string;
  recordedBy?: string;
  recordedAt?: Date;
}
