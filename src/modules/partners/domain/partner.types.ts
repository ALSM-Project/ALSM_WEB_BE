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
  /** The Organization that owns this Partner's projects/screens/conversions - the same
   * tenant boundary every other Organization-scoped entity in this platform uses (quotas,
   * billing, RBAC). Not set at Partner creation time (UC-44); lazily created the first
   * time a project is created for this Partner (UC-45), since a Partner with no projects
   * yet has no real workspace to provision. */
  organizationId?: string;
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
  findById(id: string): Promise<PartnerRecord | null>;
  create(input: CreatePartnerInput): Promise<PartnerRecord>;
  list(): Promise<PartnerRecord[]>;
  setOrganizationId(id: string, organizationId: string): Promise<void>;
}

export const PARTNER_REPOSITORY = Symbol('PARTNER_REPOSITORY');
