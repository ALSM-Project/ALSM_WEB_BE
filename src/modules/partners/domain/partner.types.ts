export enum PartnerStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

export const PARTNER_NAME_MAX_LENGTH = 200;

export interface PartnerRecord {
  id: string;
  name: string;
  contactEmail: string;
  contactName: string;
  primaryDomain: string;
  engagementType?: string;
  assignedStaffName?: string;
  status: PartnerStatus;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePartnerInput {
  name: string;
  contactEmail: string;
  contactName: string;
  primaryDomain: string;
  engagementType?: string;
  assignedStaffName?: string;
  createdBy: string;
}

export interface PartnerListFilter {
  status?: PartnerStatus;
  /** Case-insensitive match on name, contact email or domain. */
  search?: string;
}

/** Thrown by the repository when the unique contactEmail index rejects an insert — the
 * race where two identical requests both pass the findByEmail check. */
export class DuplicatePartnerEmailError extends Error {
  constructor(readonly contactEmail: string) {
    super(`Duplicate partner contact email: ${contactEmail}`);
  }
}

export interface PartnerRepository {
  findByEmail(contactEmail: string): Promise<PartnerRecord | null>;
  create(input: CreatePartnerInput): Promise<PartnerRecord>;
  /** Newest first. */
  list(filter?: PartnerListFilter): Promise<PartnerRecord[]>;
}

export const PARTNER_REPOSITORY = Symbol('PARTNER_REPOSITORY');
