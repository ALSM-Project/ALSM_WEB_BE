import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { Organization, OrganizationDocument } from '../../organizations/infrastructure/organization.schema';
import { OrganizationType } from '../../organizations/domain/organization.types';
import { ConversionJob, ConversionJobDocument } from '../../conversions/infrastructure/conversion-job.schema';
import { Project, ProjectDocument } from '../../projects/infrastructure/project.schema';
import { Screen, ScreenDocument } from '../../screens/infrastructure/screen.schema';
import { AuditLog, AuditLogDocument } from '../../audit/infrastructure/audit-log.schema';
import {
  DEFAULT_USAGE_THRESHOLDS,
  MonthlyUsageTrend,
  OrganizationUsageDetail,
  OrganizationUsageItem,
  OrganizationUsageSummary,
  UsageHealthStatus,
  UsageThresholds,
} from '../domain/organization-usage.types';
import {
  ListOrganizationUsageQueryDto,
  QuotaAmendmentDto,
  UpdateServiceStatusDto,
} from '../presentation/organization-usage.dto';
import { AUDIT_REPOSITORY, AuditRepository } from '../../audit/domain/audit.repository';

@Injectable()
export class OrganizationUsageService {
  private readonly logger = new Logger(OrganizationUsageService.name);
  private thresholds: UsageThresholds = { ...DEFAULT_USAGE_THRESHOLDS };

  constructor(
    @InjectModel(Organization.name)
    private readonly orgModel: Model<OrganizationDocument>,
    @InjectModel(ConversionJob.name)
    private readonly conversionJobModel: Model<ConversionJobDocument>,
    @InjectModel(Project.name)
    private readonly projectModel: Model<ProjectDocument>,
    @InjectModel(Screen.name)
    private readonly screenModel: Model<ScreenDocument>,
    @InjectModel(AuditLog.name)
    private readonly auditLogModel: Model<AuditLogDocument>,
    @Inject(AUDIT_REPOSITORY)
    private readonly audit: AuditRepository,
  ) {}

  /**
   * Evaluates usage health for an organization based on contracted quotas and time boundaries
   */
  private computeUsageHealth(
    org: OrganizationDocument,
    screensUsed: number,
    screenCapacity: number,
    daysUntilExpiry?: number,
  ): UsageHealthStatus {
    if (org.status === 'SUSPENDED') {
      return UsageHealthStatus.SUSPENDED;
    }

    if (daysUntilExpiry !== undefined && daysUntilExpiry <= 0) {
      return UsageHealthStatus.CONTRACT_EXPIRED;
    }

    if (screenCapacity <= 0) {
      return UsageHealthStatus.DATA_UNAVAILABLE;
    }

    const pct = (screensUsed / screenCapacity) * 100;

    if (pct >= this.thresholds.exceededPct) {
      return UsageHealthStatus.EXCEEDED;
    }

    if (pct >= this.thresholds.atLimitPct) {
      return UsageHealthStatus.AT_LIMIT;
    }

    if (pct >= this.thresholds.nearLimitPct) {
      return UsageHealthStatus.NEAR_LIMIT;
    }

    if (daysUntilExpiry !== undefined && daysUntilExpiry <= this.thresholds.expiringDays) {
      return UsageHealthStatus.CONTRACT_EXPIRING;
    }

    return UsageHealthStatus.HEALTHY;
  }

  /**
   * Helper to build filter based on scope:
   * By default or when scope/organizationType is 'ORGANIZATIONS_ONLY', excludes personal/self-service accounts.
   */
  private buildOrgScopeFilter(scope?: string, organizationType?: string): FilterQuery<OrganizationDocument> {
    const filter: FilterQuery<OrganizationDocument> = {};

    if (organizationType && organizationType !== 'ALL' && organizationType !== 'ORGANIZATIONS_ONLY') {
      filter.type = organizationType as any;
    } else if (scope === 'ALL' || organizationType === 'ALL') {
      // Include all tenants
    } else if (scope === 'PERSONAL_ONLY' || organizationType === 'SELF_SERVICE') {
      filter.$or = [
        { type: OrganizationType.SELF_SERVICE },
        { name: 'Personal Workspace' },
      ];
    } else {
      // Default: ORGANIZATIONS_ONLY (real enterprise organizations, exclude personal accounts)
      filter.type = { $ne: OrganizationType.SELF_SERVICE };
      filter.name = { $ne: 'Personal Workspace' };
    }

    return filter;
  }

  /**
   * Overview summary across customer organizations for System Admin
   */
  async getUsageSummary(query?: { scope?: string; organizationType?: string }): Promise<OrganizationUsageSummary> {
    const scopeFilter = this.buildOrgScopeFilter(query?.scope, query?.organizationType);
    const orgs = await this.orgModel.find(scopeFilter).exec();
    const totalOrganizations = orgs.length;
    let activeOrganizations = 0;
    let nearQuotaOrganizations = 0;
    let exceededQuotaOrganizations = 0;
    let suspendedOrganizations = 0;
    let contractsExpiringSoonCount = 0;
    let totalAllocatedScreenCapacity = 0;
    let totalConsumedScreenCapacity = 0;
    let totalAllocatedStorageGb = 0;
    let totalConsumedStorageGb = 0;

    const now = new Date();

    for (const org of orgs) {
      if (org.status === 'ACTIVE' || org.status === 'TRIAL') {
        activeOrganizations++;
      } else if (org.status === 'SUSPENDED') {
        suspendedOrganizations++;
      }

      const screenCap = org.contractCapacity?.screenCapacity || org.limits?.maxScreens || 20;
      const storageCap = org.contractCapacity?.storageGb || org.limits?.maxStorageGb || 5;
      totalAllocatedScreenCapacity += screenCap;
      totalAllocatedStorageGb += storageCap;

      // Count actual screens
      const screensCount = await this.screenModel.countDocuments({ organizationId: org._id });
      totalConsumedScreenCapacity += screensCount;

      let daysUntilExpiry: number | undefined;
      const expiryDate = org.contractExpiresAt || org.trialExpiresAt;
      if (expiryDate) {
        daysUntilExpiry = Math.ceil((new Date(expiryDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        if (daysUntilExpiry > 0 && daysUntilExpiry <= this.thresholds.expiringDays) {
          contractsExpiringSoonCount++;
        }
      }

      const health = this.computeUsageHealth(org, screensCount, screenCap, daysUntilExpiry);
      if (health === UsageHealthStatus.NEAR_LIMIT) {
        nearQuotaOrganizations++;
      } else if (health === UsageHealthStatus.EXCEEDED || health === UsageHealthStatus.AT_LIMIT) {
        exceededQuotaOrganizations++;
      }
    }

    return {
      totalOrganizations,
      activeOrganizations,
      nearQuotaOrganizations,
      exceededQuotaOrganizations,
      suspendedOrganizations,
      contractsExpiringSoonCount,
      totalAllocatedScreenCapacity,
      totalConsumedScreenCapacity,
      totalAllocatedStorageGb,
      totalConsumedStorageGb,
      thresholds: this.thresholds,
      lastSyncTime: new Date(),
    };
  }

  /**
   * Paginated listing of cross-organization usage with real data aggregations
   */
  async listOrganizationUsage(query: ListOrganizationUsageQueryDto) {
    const scopeFilter = this.buildOrgScopeFilter(query.scope, query.organizationType);
    const filter: FilterQuery<OrganizationDocument> = { ...scopeFilter };

    if (query.serviceMode) {
      filter.serviceMode = query.serviceMode;
    }

    if (query.contractStatus) {
      if (query.contractStatus === 'TRIAL') {
        filter.status = 'TRIAL';
      } else if (query.contractStatus === 'ACTIVE') {
        filter.status = 'ACTIVE';
      } else if (query.contractStatus === 'SUSPENDED') {
        filter.status = 'SUSPENDED';
      }
    }

    if (query.search?.trim()) {
      const searchRegex = new RegExp(query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { name: searchRegex },
        { normalizedName: searchRegex },
        { domain: searchRegex },
        { contactEmail: searchRegex },
        { activeContractNumber: searchRegex },
      ];
    }

    const orgs = await this.orgModel.find(filter).sort({ createdAt: -1 }).exec();
    const now = new Date();

    const items: OrganizationUsageItem[] = [];

    for (const org of orgs) {
      const orgId = org._id as Types.ObjectId;

      const [screensCount, activeProjectsCount, lastJob] = await Promise.all([
        this.screenModel.countDocuments({ organizationId: orgId }),
        this.projectModel.countDocuments({ organizationId: orgId, deletedAt: null }),
        this.conversionJobModel.findOne({ organizationId: orgId }).sort({ createdAt: -1 }).select('createdAt').exec(),
      ]);

      const screenCap = org.contractCapacity?.screenCapacity || org.limits?.maxScreens || 20;
      const projectCap = org.contractCapacity?.projectCapacity || org.limits?.maxProjects || 10;
      const storageCap = org.contractCapacity?.storageGb || org.limits?.maxStorageGb || 5;
      const concurrentJobsLimit = org.contractCapacity?.concurrentJobs || 2;

      let daysUntilExpiry: number | undefined;
      const expiryDate = org.contractExpiresAt || org.trialExpiresAt;
      if (expiryDate) {
        daysUntilExpiry = Math.ceil((new Date(expiryDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      }

      const screenUsagePct = screenCap > 0 ? Math.round((screensCount / screenCap) * 100) : 0;
      const overQuotaScreens = Math.max(0, screensCount - screenCap);
      const isOverQuota = screensCount > screenCap;
      const remainingScreens = Math.max(0, screenCap - screensCount);
      const remainingProjects = Math.max(0, projectCap - activeProjectsCount);

      let contractStatus: 'ACTIVE' | 'TRIAL' | 'EXPIRED' | 'SUSPENDED' | 'NO_CONTRACT' = 'NO_CONTRACT';
      if (org.status === 'SUSPENDED') {
        contractStatus = 'SUSPENDED';
      } else if (daysUntilExpiry !== undefined && daysUntilExpiry <= 0) {
        contractStatus = 'EXPIRED';
      } else if (org.contractId || org.activeContractNumber) {
        contractStatus = 'ACTIVE';
      } else if (org.status === 'TRIAL') {
        contractStatus = 'TRIAL';
      }

      const health = this.computeUsageHealth(org, screensCount, screenCap, daysUntilExpiry);

      if (query.health && health !== query.health) {
        continue;
      }

      items.push({
        organizationId: org.id,
        name: org.name,
        normalizedName: org.normalizedName,
        companyName: org.name,
        contactEmail: org.contactEmail,
        domain: org.domain,
        organizationType: (org.type as string) || (org.name === 'Personal Workspace' ? 'SELF_SERVICE' : 'ENTERPRISE'),
        serviceMode: org.serviceMode || 'CUSTOMER_SELF_SERVICE',
        subscriptionPlan: org.engagementType || (org.status === 'TRIAL' ? 'Enterprise Evaluation' : 'Enterprise Standard'),
        contractStatus,
        contractNumber: org.activeContractNumber,
        contractExpiresAt: expiryDate,
        daysUntilContractExpiry: daysUntilExpiry,
        screenCapacity: screenCap,
        screenUsage: screensCount,
        remainingScreens,
        overQuotaScreens,
        isOverQuota,
        isConversionBlocked: isOverQuota,
        screenUsagePct,
        projectCapacity: projectCap,
        activeProjects: activeProjectsCount,
        remainingProjects,
        storageCapacityGb: storageCap,
        storageUsageGb: 0,
        remainingStorageGb: storageCap,
        concurrentJobsLimit,
        activeJobs: 0,
        health,
        orgStatus: org.status as 'ACTIVE' | 'SUSPENDED' | 'TRIAL',
        createdAt: org.createdAt,
        lastActivityAt: lastJob?.createdAt || org.updatedAt,
      });
    }

    // Sort items
    const sortBy = query.sortBy || 'screenUsagePct';
    const isAsc = query.sortOrder === 'asc';
    items.sort((a, b) => {
      let valA = (a as any)[sortBy];
      let valB = (b as any)[sortBy];
      if (valA === undefined) valA = 0;
      if (valB === undefined) valB = 0;
      if (valA < valB) return isAsc ? -1 : 1;
      if (valA > valB) return isAsc ? 1 : -1;
      return 0;
    });

    const total = items.length;
    const page = Math.max(1, query.page || 1);
    const limit = Math.max(1, Math.min(100, query.limit || 10));
    const paginatedItems = items.slice((page - 1) * limit, page * limit);

    return {
      items: paginatedItems,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      thresholds: this.thresholds,
      lastSyncTime: new Date(),
    };
  }

  /**
   * Detail view for single organization usage & quota monitoring
   */
  async getOrganizationUsageDetail(id: string): Promise<OrganizationUsageDetail> {
    const org = await this.orgModel.findById(id).exec();
    if (!org) {
      throw new NotFoundException(`Organization '${id}' not found`);
    }

    const orgId = org._id as Types.ObjectId;

    const [screensCount, activeProjectsCount, recentJobs, auditLogs] = await Promise.all([
      this.screenModel.countDocuments({ organizationId: orgId }),
      this.projectModel.countDocuments({ organizationId: orgId, deletedAt: null }),
      this.conversionJobModel.find({ organizationId: orgId }).sort({ createdAt: -1 }).limit(20).exec(),
      this.auditLogModel
        .find({
          $or: [
            { organizationId: orgId },
            { resourceId: org.id },
            { action: { $regex: /QUOTA|ORGANIZATION/i } },
          ],
        })
        .sort({ createdAt: -1 })
        .limit(15)
        .exec(),
    ]);

    // Compute monthly usage trends (past 6 months)
    const monthlyTrends: MonthlyUsageTrend[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const nextMonth = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      const year = d.getFullYear();
      const month = d.getMonth() + 1;
      const monthLabel = d.toLocaleString('en-US', { month: 'short', year: 'numeric' });

      const [screensInMonth, successfulJobs, failedJobs] = await Promise.all([
        this.screenModel.countDocuments({
          organizationId: orgId,
          createdAt: { $gte: d, $lt: nextMonth },
        }),
        this.conversionJobModel.countDocuments({
          organizationId: orgId,
          status: 'COMPLETED',
          createdAt: { $gte: d, $lt: nextMonth },
        }),
        this.conversionJobModel.countDocuments({
          organizationId: orgId,
          status: 'FAILED',
          createdAt: { $gte: d, $lt: nextMonth },
        }),
      ]);

      monthlyTrends.push({
        year,
        month,
        monthLabel,
        screensConverted: screensInMonth,
        successfulJobs,
        failedJobs,
      });
    }

    const screenCap = org.contractCapacity?.screenCapacity || org.limits?.maxScreens || 20;
    const projectCap = org.contractCapacity?.projectCapacity || org.limits?.maxProjects || 10;
    const storageCap = org.contractCapacity?.storageGb || org.limits?.maxStorageGb || 5;
    const concurrentJobsLimit = org.contractCapacity?.concurrentJobs || 2;

    let daysUntilExpiry: number | undefined;
    const expiryDate = org.contractExpiresAt || org.trialExpiresAt;
    if (expiryDate) {
      daysUntilExpiry = Math.ceil((new Date(expiryDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    }

    const screenUsagePct = screenCap > 0 ? Math.round((screensCount / screenCap) * 100) : 0;
    const overQuotaScreens = Math.max(0, screensCount - screenCap);
    const isOverQuota = screensCount > screenCap;
    const remainingScreens = Math.max(0, screenCap - screensCount);
    const remainingProjects = Math.max(0, projectCap - activeProjectsCount);

    let contractStatus: 'ACTIVE' | 'TRIAL' | 'EXPIRED' | 'SUSPENDED' | 'NO_CONTRACT' = 'NO_CONTRACT';
    if (org.status === 'SUSPENDED') {
      contractStatus = 'SUSPENDED';
    } else if (daysUntilExpiry !== undefined && daysUntilExpiry <= 0) {
      contractStatus = 'EXPIRED';
    } else if (org.contractId || org.activeContractNumber) {
      contractStatus = 'ACTIVE';
    } else if (org.status === 'TRIAL') {
      contractStatus = 'TRIAL';
    }

    const health = this.computeUsageHealth(org, screensCount, screenCap, daysUntilExpiry);

    return {
      organizationId: org.id,
      name: org.name,
      normalizedName: org.normalizedName,
      companyName: org.name,
      contactEmail: org.contactEmail,
      domain: org.domain,
      serviceMode: org.serviceMode || 'CUSTOMER_SELF_SERVICE',
      subscriptionPlan: org.engagementType || (org.status === 'TRIAL' ? 'Enterprise Evaluation' : 'Enterprise Standard'),
      contractStatus,
      contractNumber: org.activeContractNumber,
      contractExpiresAt: expiryDate,
      daysUntilContractExpiry: daysUntilExpiry,
      screenCapacity: screenCap,
      screenUsage: screensCount,
      remainingScreens,
      overQuotaScreens,
      isOverQuota,
      isConversionBlocked: isOverQuota,
      screenUsagePct,
      projectCapacity: projectCap,
      activeProjects: activeProjectsCount,
      remainingProjects,
      storageCapacityGb: storageCap,
      storageUsageGb: 0,
      remainingStorageGb: storageCap,
      concurrentJobsLimit,
      activeJobs: 0,
      health,
      orgStatus: org.status as 'ACTIVE' | 'SUSPENDED' | 'TRIAL',
      createdAt: org.createdAt,
      lastActivityAt: recentJobs[0]?.createdAt || org.updatedAt,
      membersCount: org.members?.length || 0,
      monthlyTrends,
      recentActivities: recentJobs.map((j) => ({
        id: j.id,
        projectId: j.projectId.toString(),
        conversionType: j.conversionType,
        status: j.status,
        priority: j.priority,
        attemptCount: j.attemptCount,
        startedAt: j.startedAt,
        completedAt: j.completedAt,
        durationSeconds:
          j.startedAt && j.completedAt
            ? Math.round((j.completedAt.getTime() - j.startedAt.getTime()) / 1000)
            : undefined,
        errorCode: j.errorCode,
        errorMessage: j.errorMessage,
        createdAt: j.createdAt,
      })),
      contractHistory: {
        contractNumber: org.activeContractNumber,
        contractId: org.contractId?.toString(),
        status: contractStatus,
        expiresAt: expiryDate,
      },
      auditHistory: auditLogs.map((a) => ({
        action: a.action,
        actorUserId: a.actorUserId?.toString(),
        createdAt: a.createdAt,
        metadata: a.metadata,
      })),
    };
  }

  /**
   * Applies an authorized quota amendment to an organization
   */
  async applyQuotaAmendment(
    id: string,
    dto: QuotaAmendmentDto,
    actor: { userId: string; email: string },
  ) {
    const org = await this.orgModel.findById(id).exec();
    if (!org) {
      throw new NotFoundException(`Organization '${id}' not found`);
    }

    if (!org.contractCapacity) {
      org.contractCapacity = {
        screenCapacity: org.limits?.maxScreens || 20,
        programCapacity: org.limits?.maxPrograms || 10,
        projectCapacity: org.limits?.maxProjects || 10,
        userSeats: 5,
        concurrentJobs: 2,
        storageGb: org.limits?.maxStorageGb || 5,
      };
    }
    if (!org.limits) {
      org.limits = {
        maxScreens: 20,
        maxPrograms: 10,
        maxStorageGb: 5,
        maxProjects: 10,
        maxConversionsPerMonth: 100,
        aiValidationEnabled: true,
        trialScreens: 15,
        trialPrograms: 8,
        trialStorageGb: 5,
      };
    }

    const previousScreenCap = org.contractCapacity.screenCapacity;

    if (dto.targetScreenCapacity !== undefined) {
      org.contractCapacity.screenCapacity = Math.max(0, Number(dto.targetScreenCapacity));
      org.limits.maxScreens = org.contractCapacity.screenCapacity;
    } else if (dto.screenCapacityDelta) {
      org.contractCapacity.screenCapacity = Math.max(0, org.contractCapacity.screenCapacity + dto.screenCapacityDelta);
      org.limits.maxScreens = org.contractCapacity.screenCapacity;
    }

    if (dto.targetStorageGb !== undefined) {
      org.contractCapacity.storageGb = Math.max(1, Number(dto.targetStorageGb));
      org.limits.maxStorageGb = org.contractCapacity.storageGb;
    } else if (dto.storageGbDelta) {
      org.contractCapacity.storageGb = Math.max(1, org.contractCapacity.storageGb + dto.storageGbDelta);
      org.limits.maxStorageGb = org.contractCapacity.storageGb;
    }

    if (dto.targetProjectCapacity !== undefined) {
      org.contractCapacity.projectCapacity = Math.max(1, Number(dto.targetProjectCapacity));
      org.limits.maxProjects = org.contractCapacity.projectCapacity;
    } else if (dto.projectCapacityDelta) {
      org.contractCapacity.projectCapacity = Math.max(1, org.contractCapacity.projectCapacity + dto.projectCapacityDelta);
      org.limits.maxProjects = org.contractCapacity.projectCapacity;
    }

    if (dto.targetConcurrentJobs !== undefined) {
      org.contractCapacity.concurrentJobs = Math.max(1, Number(dto.targetConcurrentJobs));
    }

    if (dto.targetMembers !== undefined) {
      org.contractCapacity.userSeats = Math.max(1, Number(dto.targetMembers));
    }

    if (dto.expirationDate) {
      org.contractExpiresAt = new Date(dto.expirationDate);
    }

    const updated = await org.save();

    await this.audit.append({
      actorUserId: actor.userId,
      organizationId: org.id,
      action: 'ORGANIZATION_QUOTA_AMENDED',
      resourceType: 'ORGANIZATION',
      resourceId: org.id,
      metadata: {
        amendmentType: dto.amendmentType,
        contractReference: dto.contractReference,
        justification: dto.justification,
        previousScreenCapacity: String(previousScreenCap),
        newScreenCapacity: String(updated.contractCapacity?.screenCapacity),
      },
    });

    this.logger.log(
      `Quota amended for org ${org.name} (${org.id}): screenCapacity ${previousScreenCap} -> ${updated.contractCapacity?.screenCapacity}`,
    );

    return this.getOrganizationUsageDetail(id);
  }

  /**
   * Suspend or reactivate organization service
   */
  async updateServiceStatus(
    id: string,
    dto: UpdateServiceStatusDto,
    actor: { userId: string; email: string },
  ) {
    const org = await this.orgModel.findById(id).exec();
    if (!org) {
      throw new NotFoundException(`Organization '${id}' not found`);
    }

    const newStatus = dto.action === 'SUSPEND' ? 'SUSPENDED' : 'ACTIVE';
    const previousStatus = org.status;
    org.status = newStatus as 'ACTIVE' | 'SUSPENDED';

    const updated = await org.save();

    await this.audit.append({
      actorUserId: actor.userId,
      organizationId: org.id,
      action: dto.action === 'SUSPEND' ? 'ORGANIZATION_SERVICE_SUSPENDED' : 'ORGANIZATION_SERVICE_REACTIVATED',
      resourceType: 'ORGANIZATION',
      resourceId: org.id,
      metadata: {
        previousStatus,
        newStatus,
        reason: dto.reason,
      },
    });

    return {
      organizationId: updated.id,
      name: updated.name,
      status: updated.status,
      message: `Organization service successfully ${dto.action === 'SUSPEND' ? 'suspended' : 'reactivated'}.`,
    };
  }
}
