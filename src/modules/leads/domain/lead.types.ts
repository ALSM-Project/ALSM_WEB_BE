export enum LeadStatus {
  NEW = 'NEW',
  CONTACTED = 'CONTACTED',
  QUALIFIED = 'QUALIFIED',
  PROPOSAL = 'PROPOSAL',
  NEGOTIATION = 'NEGOTIATION',
  WON = 'WON',
  LOST = 'LOST',
}

export enum LeadSource {
  WEBSITE = 'WEBSITE',
  REFERRAL = 'REFERRAL',
  COLD_CALL = 'COLD_CALL',
  EMAIL_CAMPAIGN = 'EMAIL_CAMPAIGN',
  SOCIAL_MEDIA = 'SOCIAL_MEDIA',
  TRADE_SHOW = 'TRADE_SHOW',
  PARTNER = 'PARTNER',
  OTHER = 'OTHER',
}

export enum LeadPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export interface LeadRecord {
  id: string;
  companyName: string;
  contactName: string;
  contactEmail: string;
  contactPhone?: string;
  jobTitle?: string;
  status: LeadStatus;
  source: LeadSource;
  priority: LeadPriority;
  estimatedValue?: number;
  currency: string;
  notes?: string;
  assignedToUserId?: string;
  assignedToEmail?: string;
  tags: string[];
  lastContactedAt?: Date;
  nextFollowUpAt?: Date;
  createdByUserId: string;
  createdByEmail: string;
  quotes?: LeadQuoteItem[];
  createdAt: Date;
  updatedAt: Date;
}

export interface LeadQuoteItem {
  id: string;
  quoteNumber: string;
  planName: string;
  projectScope?: string;
  amount: number;
  discountPercent?: number;
  discountApproved?: boolean;
  discountReason?: string;
  status: 'DRAFT' | 'PENDING_APPROVAL' | 'SENT' | 'ACCEPTED' | 'REJECTED';
  recipientEmail?: string;
  expiresAt?: Date;
  sentAt?: Date;
  pdfUrl?: string;
  createdAt: Date;
}

export interface CreateLeadInput {
  companyName: string;
  contactName: string;
  contactEmail: string;
  contactPhone?: string;
  jobTitle?: string;
  source: LeadSource;
  priority: LeadPriority;
  estimatedValue?: number;
  currency?: string;
  notes?: string;
  assignedToUserId?: string;
  assignedToEmail?: string;
  tags?: string[];
  createdByUserId: string;
  createdByEmail: string;
}

export interface LeadListParams {
  status?: LeadStatus;
  source?: LeadSource;
  priority?: LeadPriority;
  assignedToUserId?: string;
  search?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export const ALLOWED_LEAD_STATUS_TRANSITIONS: Record<LeadStatus, LeadStatus[]> = {
  [LeadStatus.NEW]: [LeadStatus.CONTACTED, LeadStatus.QUALIFIED, LeadStatus.LOST],
  [LeadStatus.CONTACTED]: [LeadStatus.QUALIFIED, LeadStatus.PROPOSAL, LeadStatus.LOST],
  [LeadStatus.QUALIFIED]: [LeadStatus.PROPOSAL, LeadStatus.NEGOTIATION, LeadStatus.LOST],
  [LeadStatus.PROPOSAL]: [LeadStatus.NEGOTIATION, LeadStatus.WON, LeadStatus.LOST],
  [LeadStatus.NEGOTIATION]: [LeadStatus.PROPOSAL, LeadStatus.WON, LeadStatus.LOST],
  [LeadStatus.WON]: [LeadStatus.NEGOTIATION, LeadStatus.LOST],
  [LeadStatus.LOST]: [LeadStatus.NEW, LeadStatus.CONTACTED, LeadStatus.QUALIFIED],
};

export function isAllowedLeadStatusTransition(
  currentStatus: LeadStatus,
  targetStatus: LeadStatus,
): boolean {
  if (currentStatus === targetStatus) return true;
  return ALLOWED_LEAD_STATUS_TRANSITIONS[currentStatus]?.includes(targetStatus) ?? false;
}

export interface UpdateLeadStatusOptions {
  notes?: string;
  lastContactedAt?: Date;
  nextFollowUpAt?: Date;
}

export interface LeadRepository {
  create(input: CreateLeadInput): Promise<LeadRecord>;
  findById(id: string): Promise<LeadRecord | null>;
  list(params?: LeadListParams): Promise<{ items: LeadRecord[]; total: number }>;
  countByStatus(): Promise<Record<string, number>>;
  updateStatus(
    id: string,
    status: LeadStatus,
    options?: UpdateLeadStatusOptions,
  ): Promise<LeadRecord | null>;
  addQuote(
    id: string,
    quote: LeadQuoteItem,
    newStatus?: LeadStatus,
  ): Promise<LeadRecord | null>;
}

export const LEAD_REPOSITORY = Symbol('LEAD_REPOSITORY');

