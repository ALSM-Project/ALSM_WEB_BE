export enum LeadStatus {
  ASSIGNED = 'ASSIGNED',
  CONVERTED = 'CONVERTED',
}
export interface LeadAssignment {
  id: string;
  teamId: string;
  salespersonId: string;
  startedAt: Date;
  actorUserId: string;
  expectedRevision: number;
}
export interface LeadConversion {
  id: string;
  customerUserId: string;
  reference: string;
  convertedAt: Date;
  actorUserId: string;
  assignmentId: string;
  teamId: string;
  salespersonId: string;
}
export interface LeadRecord {
  status: LeadStatus;
  id: string;
  organizationId: string;
  title: string;
  sourceReference: string;
  contactEmail?: string;
  revision: number;
  activeAssignment: LeadAssignment;
  assignments: LeadAssignment[];
  conversion?: LeadConversion;
  replayed?: boolean;
  contactName?: string;
  company?: string;
  phone?: string;
  source?: string;
  stage?: 'NEW' | 'CONTACTED' | 'QUALIFIED' | 'PROPOSAL' | 'WON' | 'LOST';
  score?: number;
  lastContactAt?: Date;
  notes?: string;
  interactions?: Record<string, unknown>[];
  demos?: Record<string, unknown>[];
  quotes?: Record<string, unknown>[];
  contracts?: Record<string, unknown>[];
  assignedTo?: string;
}
export interface CreateLead {
  leadId: string;
  organizationId: string;
  actorUserId: string;
  title: string;
  sourceReference: string;
  contactEmail?: string;
  assignment: LeadAssignment;
}
export interface LeadRepository {
  create(input: CreateLead): Promise<LeadRecord>;
  findById(id: string, organizationId: string): Promise<LeadRecord | null>;
  assign(
    id: string,
    organizationId: string,
    assignment: LeadAssignment,
  ): Promise<LeadRecord | null>;
  convert(
    id: string,
    organizationId: string,
    expectedRevision: number,
    conversion: LeadConversion,
  ): Promise<LeadRecord | null>;
}
export const LEAD_REPOSITORY = Symbol('LEAD_REPOSITORY');
