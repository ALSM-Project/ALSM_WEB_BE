import { OrganizationRole, OrganizationType } from './organization.types';
export interface OrganizationRecord {
  id: string;
  name: string;
  type: OrganizationType;
  members: { userId: string; role: OrganizationRole }[];
  createdAt: Date;
  updatedAt: Date;
}
export interface OrganizationRepository {
  create(input: Pick<OrganizationRecord, 'name' | 'type' | 'members'>): Promise<OrganizationRecord>;
  findForMember(organizationId: string, userId: string): Promise<OrganizationRecord | null>;
  /** The organization itself, whoever is asking; callers must have their own reason to read it. */
  findById(organizationId: string): Promise<OrganizationRecord | null>;
  findFirstForMember(userId: string): Promise<OrganizationRecord | null>;
  addMember(
    organizationId: string,
    member: { userId: string; role: OrganizationRole },
  ): Promise<void>;
}
export const ORGANIZATION_REPOSITORY = Symbol('ORGANIZATION_REPOSITORY');
