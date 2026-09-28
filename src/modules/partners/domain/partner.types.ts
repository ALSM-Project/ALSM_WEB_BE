export enum PartnerStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

export interface PartnerRecord {
  id: string;
  name: string;
  contactEmail: string;
  contactPhone?: string;
  website?: string;
  address?: string;
  notes?: string;
  status: PartnerStatus;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePartnerInput {
  name: string;
  contactEmail: string;
  contactPhone?: string;
  website?: string;
  address?: string;
  notes?: string;
  createdBy: string;
}

export interface PartnerRepository {
  findByEmail(contactEmail: string): Promise<PartnerRecord | null>;
  create(input: CreatePartnerInput): Promise<PartnerRecord>;
  list(): Promise<PartnerRecord[]>;
}

export const PARTNER_REPOSITORY = Symbol('PARTNER_REPOSITORY');
