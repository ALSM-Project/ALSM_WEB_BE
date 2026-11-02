import { OrganizationType } from './organization.types';

/** Deliberately excludes contact addresses, members, accounts and commercial details. */
export interface SupportOrganizationMetadata {
  id: string;
  name: string;
  type: OrganizationType;
  status: 'ACTIVE' | 'TRIAL';
}

export interface SupportOrganizationSearch {
  field: 'name' | 'email';
  query: string;
  limit: number;
  afterId?: string;
}

export interface SupportOrganizationDirectory {
  search(input: SupportOrganizationSearch, now: Date): Promise<SupportOrganizationMetadata[]>;
  eligible(id: string, now: Date): Promise<SupportOrganizationMetadata | null>;
}

export const SUPPORT_ORGANIZATION_DIRECTORY = Symbol('SUPPORT_ORGANIZATION_DIRECTORY');
