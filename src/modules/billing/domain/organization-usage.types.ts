export enum UsageHealthStatus {
  HEALTHY = 'HEALTHY',
  NEAR_LIMIT = 'NEAR_LIMIT',
  AT_LIMIT = 'AT_LIMIT',
  EXCEEDED = 'EXCEEDED',
  CONTRACT_EXPIRING = 'CONTRACT_EXPIRING',
  CONTRACT_EXPIRED = 'CONTRACT_EXPIRED',
  SUSPENDED = 'SUSPENDED',
  DATA_UNAVAILABLE = 'DATA_UNAVAILABLE',
}

export interface UsageThresholds {
  nearLimitPct: number;    // default: 80%
  atLimitPct: number;      // default: 95%
  exceededPct: number;     // default: 100%
  expiringDays: number;    // default: 30 days
}

export const DEFAULT_USAGE_THRESHOLDS: UsageThresholds = {
  nearLimitPct: 80,
  atLimitPct: 95,
  exceededPct: 100,
  expiringDays: 30,
};

export interface OrganizationUsageSummary {
  totalOrganizations: number;
  activeOrganizations: number;
  nearQuotaOrganizations: number;
  exceededQuotaOrganizations: number;
  suspendedOrganizations: number;
  contractsExpiringSoonCount: number;
  totalAllocatedScreenCapacity: number;
  totalConsumedScreenCapacity: number;
  totalAllocatedStorageGb: number;
  totalConsumedStorageGb: number;
  thresholds: UsageThresholds;
  lastSyncTime: Date;
}

export interface OrganizationUsageItem {
  organizationId: string;
  name: string;
  normalizedName?: string;
  companyName?: string;
  contactEmail?: string;
  domain?: string;
  organizationType?: string;
  serviceMode: 'ALSM_MANAGED' | 'CUSTOMER_SELF_SERVICE';
  subscriptionPlan: string;
  contractStatus: 'ACTIVE' | 'TRIAL' | 'EXPIRED' | 'SUSPENDED' | 'NO_CONTRACT';
  contractNumber?: string;
  contractExpiresAt?: Date;
  daysUntilContractExpiry?: number;
  screenCapacity: number;
  screenUsage: number;
  remainingScreens: number;
  overQuotaScreens?: number;
  isOverQuota?: boolean;
  isConversionBlocked?: boolean;
  screenUsagePct: number;
  projectCapacity: number;
  activeProjects: number;
  remainingProjects: number;
  storageCapacityGb: number;
  storageUsageGb: number;
  remainingStorageGb: number;
  concurrentJobsLimit: number;
  activeJobs: number;
  health: UsageHealthStatus;
  orgStatus: 'ACTIVE' | 'SUSPENDED' | 'TRIAL';
  createdAt: Date;
  lastActivityAt?: Date;
}

export interface MonthlyUsageTrend {
  year: number;
  month: number; // 1-12
  monthLabel: string;
  screensConverted: number;
  successfulJobs: number;
  failedJobs: number;
}

export interface ConversionActivityItem {
  id: string;
  projectId: string;
  projectName?: string;
  screenId?: string;
  screenName?: string;
  conversionType: string;
  status: string;
  priority: string;
  attemptCount: number;
  startedAt?: Date;
  completedAt?: Date;
  durationSeconds?: number;
  errorCode?: string;
  errorMessage?: string;
  createdAt: Date;
}

export interface OrganizationUsageDetail extends OrganizationUsageItem {
  membersCount: number;
  monthlyTrends: MonthlyUsageTrend[];
  recentActivities: ConversionActivityItem[];
  contractHistory?: {
    contractNumber?: string;
    contractId?: string;
    status?: string;
    effectiveDate?: Date;
    expiresAt?: Date;
  };
  auditHistory: Array<{
    action: string;
    actorUserId?: string;
    actorEmail?: string;
    createdAt?: Date;
    metadata?: Record<string, string>;
  }>;
}
