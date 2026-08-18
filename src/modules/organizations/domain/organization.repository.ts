import { OrganizationRole, OrganizationType } from './organization.types';
export interface OrganizationRecord { id: string; name: string; type: OrganizationType; members: { userId: string; role: OrganizationRole }[]; createdAt: Date; updatedAt: Date; }
export interface OrganizationRepository { create(input: Pick<OrganizationRecord, 'name' | 'type' | 'members'>): Promise<OrganizationRecord>; findForMember(organizationId: string, userId: string): Promise<OrganizationRecord | null>; findFirstForMember(userId: string): Promise<OrganizationRecord | null>; }
export const ORGANIZATION_REPOSITORY = Symbol('ORGANIZATION_REPOSITORY');
