export interface SessionBootstrapUser {
  id: string;
  email: string;
  fullName: string;
  avatarUrl?: string;
  role: string;
  orgRole: string;
  isPlatformAdmin?: boolean;
}

export interface SessionBootstrapOrganization {
  id: string | null;
  name: string;
  tier?: string;
  status: string;
  slug?: string;
}

export interface SessionBootstrapContract {
  id: string | null;
  contractNumber: string | null;
  serviceMode: 'SELF_SERVICE' | 'WE_CONVERT_FOR_YOU' | 'HYBRID';
  status: 'ACTIVE' | 'SUSPENDED' | 'EXPIRED' | 'TRIAL' | 'NONE';
  validUntil?: string | null;
  isReadOnly: boolean;
}

export interface SessionBootstrapQuotas {
  screensLimit: number;
  screensUsed: number;
  storageLimitMb: number;
  storageUsedMb: number;
  conversionsMonthlyLimit: number;
  conversionsUsed: number;
}

export interface SessionBootstrapPayload {
  user: SessionBootstrapUser;
  organization: SessionBootstrapOrganization;
  contract: SessionBootstrapContract;
  capabilities: string[];
  quotas: SessionBootstrapQuotas;
  featureFlags: Record<string, boolean>;
  sourceTimestamp: string;
  navigationTree?: any[];
}
