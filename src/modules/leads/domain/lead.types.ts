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
  createdAt: Date;
  updatedAt: Date;
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

export interface LeadRepository {
  create(input: CreateLeadInput): Promise<LeadRecord>;
  findById(id: string): Promise<LeadRecord | null>;
  list(params?: LeadListParams): Promise<{ items: LeadRecord[]; total: number }>;
  countByStatus(): Promise<Record<string, number>>;
}

export const LEAD_REPOSITORY = Symbol('LEAD_REPOSITORY');
