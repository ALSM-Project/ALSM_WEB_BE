import { Model, Types } from 'mongoose';
import { OrganizationUsageService } from '../src/modules/billing/application/organization-usage.service';
import { Organization, OrganizationDocument } from '../src/modules/organizations/infrastructure/organization.schema';
import { ConversionJob, ConversionJobDocument } from '../src/modules/conversions/infrastructure/conversion-job.schema';
import { Project, ProjectDocument } from '../src/modules/projects/infrastructure/project.schema';
import { Screen, ScreenDocument } from '../src/modules/screens/infrastructure/screen.schema';
import { AuditLog, AuditLogDocument } from '../src/modules/audit/infrastructure/audit-log.schema';
import { AuditRepository } from '../src/modules/audit/domain/audit.repository';
import { UsageHealthStatus } from '../src/modules/billing/domain/organization-usage.types';

describe('OrganizationUsageService (Cross-Organization Quota Monitoring)', () => {
  let service: OrganizationUsageService;

  const mockOrgId = new Types.ObjectId();
  const mockOrg: any = {
    _id: mockOrgId,
    id: mockOrgId.toString(),
    name: 'Enterprise Bank Corp',
    normalizedName: 'enterprise-bank-corp',
    domain: 'bank.example.com',
    status: 'ACTIVE',
    serviceMode: 'ALSM_MANAGED',
    contractCapacity: {
      screenCapacity: 100,
      programCapacity: 50,
      projectCapacity: 10,
      storageGb: 20,
      concurrentJobs: 4,
    },
    limits: {
      maxScreens: 100,
      maxPrograms: 50,
      maxStorageGb: 20,
      maxProjects: 10,
    },
    members: [{ userId: new Types.ObjectId(), role: 'OWNER' }],
    createdAt: new Date(),
    updatedAt: new Date(),
    save: jest.fn().mockImplementation(function (this: any) {
      return Promise.resolve(this);
    }),
  };

  const orgModel = {
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([mockOrg]),
    }),
    findById: jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(mockOrg),
    }),
  } as unknown as Model<OrganizationDocument>;

  const conversionJobModel = {
    countDocuments: jest.fn().mockResolvedValue(5),
    findOne: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue({ createdAt: new Date() }),
    }),
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([
        {
          id: 'job-1',
          projectId: new Types.ObjectId(),
          conversionType: 'BMS_TO_REACT',
          status: 'COMPLETED',
          priority: 'NORMAL',
          attemptCount: 1,
          startedAt: new Date(Date.now() - 60000),
          completedAt: new Date(),
          createdAt: new Date(),
        },
      ]),
    }),
  } as unknown as Model<ConversionJobDocument>;

  const projectModel = {
    countDocuments: jest.fn().mockResolvedValue(2),
  } as unknown as Model<ProjectDocument>;

  const screenModel = {
    countDocuments: jest.fn().mockResolvedValue(25),
  } as unknown as Model<ScreenDocument>;

  const auditLogModel = {
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([
        {
          action: 'ORGANIZATION_QUOTA_AMENDED',
          actorUserId: new Types.ObjectId(),
          createdAt: new Date(),
          metadata: { justification: 'Annual contract expansion' },
        },
      ]),
    }),
  } as unknown as Model<AuditLogDocument>;

  const audit = {
    append: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new OrganizationUsageService(
      orgModel,
      conversionJobModel,
      projectModel,
      screenModel,
      auditLogModel,
      audit,
    );
  });

  it('aggregates global usage summary across organizations', async () => {
    const summary = await service.getUsageSummary();

    expect(summary.totalOrganizations).toBe(1);
    expect(summary.activeOrganizations).toBe(1);
    expect(summary.totalAllocatedScreenCapacity).toBe(100);
    expect(summary.totalConsumedScreenCapacity).toBe(25);
    expect(summary.thresholds.nearLimitPct).toBe(80);
    expect(summary.lastSyncTime).toBeDefined();
  });

  it('lists cross-organization usage with calculated metrics and healthy status', async () => {
    const res = await service.listOrganizationUsage({ page: 1, limit: 10 });

    expect(res.items).toHaveLength(1);
    const item = res.items[0];
    expect(item.name).toBe('Enterprise Bank Corp');
    expect(item.screenCapacity).toBe(100);
    expect(item.screenUsage).toBe(25);
    expect(item.screenUsagePct).toBe(25);
    expect(item.remainingScreens).toBe(75);
    expect(item.health).toBe(UsageHealthStatus.HEALTHY);
  });

  it('correctly flags NEAR_LIMIT and EXCEEDED statuses when screen usage crosses thresholds', async () => {
    // 85% used -> NEAR_LIMIT
    (screenModel.countDocuments as jest.Mock).mockResolvedValueOnce(85);
    const nearRes = await service.listOrganizationUsage({ page: 1, limit: 10 });
    expect(nearRes.items[0].health).toBe(UsageHealthStatus.NEAR_LIMIT);

    // 100% used -> EXCEEDED
    (screenModel.countDocuments as jest.Mock).mockResolvedValueOnce(105);
    const exceededRes = await service.listOrganizationUsage({ page: 1, limit: 10 });
    expect(exceededRes.items[0].health).toBe(UsageHealthStatus.EXCEEDED);
  });

  it('returns organization usage detail with trends, recent activities, and audit history', async () => {
    const detail = await service.getOrganizationUsageDetail(mockOrgId.toString());

    expect(detail.organizationId).toBe(mockOrgId.toString());
    expect(detail.name).toBe('Enterprise Bank Corp');
    expect(detail.monthlyTrends).toHaveLength(6);
    expect(detail.recentActivities).toHaveLength(1);
    expect(detail.auditHistory).toHaveLength(1);
  });

  it('applies an authorized quota amendment and writes an audit log', async () => {
    const actor = { userId: new Types.ObjectId().toString(), email: 'admin@alsm.dev' };
    await service.applyQuotaAmendment(
      mockOrgId.toString(),
      {
        amendmentType: 'CAPACITY_UPGRADE',
        screenCapacityDelta: 50,
        storageGbDelta: 10,
        contractReference: 'CTR-2026-AMD-001',
        justification: 'Client purchased additional 50 BMS screens bundle',
      },
      actor,
    );

    expect(mockOrg.contractCapacity.screenCapacity).toBe(150);
    expect(mockOrg.limits.maxScreens).toBe(150);
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ORGANIZATION_QUOTA_AMENDED',
      }),
    );
  });

  it('suspends and reactivates organization service', async () => {
    const actor = { userId: new Types.ObjectId().toString(), email: 'admin@alsm.dev' };
    const res = await service.updateServiceStatus(
      mockOrgId.toString(),
      { action: 'SUSPEND', reason: 'Contract under renewal dispute' },
      actor,
    );

    expect(res.status).toBe('SUSPENDED');
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ORGANIZATION_SERVICE_SUSPENDED',
      }),
    );
  });
});
