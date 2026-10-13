import { Test, TestingModule } from '@nestjs/testing';
import { UsageService } from '../src/modules/billing/application/usage.service';
import {
  BILLING_USAGE_REPOSITORY,
  IBillingUsageRepository,
  SubscriptionProps,
} from '../src/modules/billing/domain/billing.repository.interface';
import {
  PlanTier,
  SubscriptionStatus,
  BillingCycle,
  PLAN_CATALOGUE,
} from '../src/modules/billing/domain/billing.types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSubscription(overrides: Partial<SubscriptionProps> = {}): SubscriptionProps {
  return {
    id: 'sub-1',
    userId: 'user-1',
    organizationId: 'org-1',
    planTier: PlanTier.STARTER,
    planName: 'Starter',
    billingCycle: BillingCycle.MONTHLY,
    status: SubscriptionStatus.ACTIVE,
    amountVnd: 99_000,
    currentPeriodStart: new Date('2026-09-01'),
    currentPeriodEnd: new Date('2026-09-30'),
    ...overrides,
  };
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('UC-35: View Service Usage — UsageService', () => {
  let service: UsageService;
  let usageRepo: jest.Mocked<IBillingUsageRepository>;

  const USER_ID = 'user-abc';
  const ORG_ID = 'org-xyz';

  beforeEach(async () => {
    usageRepo = {
      findActiveSubscription: jest.fn(),
      countProjectsByOrganization: jest.fn(),
      countConversionsByOrganizationSince: jest.fn(),
      getMonthlyConversions: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [UsageService, { provide: BILLING_USAGE_REPOSITORY, useValue: usageRepo }],
    }).compile();

    service = module.get<UsageService>(UsageService);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Case 1: No subscription → defaults to Starter plan
  // ─────────────────────────────────────────────────────────────────────────────
  it('Case 1: returns Starter plan defaults when user has no active subscription', async () => {
    usageRepo.findActiveSubscription.mockResolvedValue(null);
    usageRepo.countProjectsByOrganization.mockResolvedValue(0);
    usageRepo.countConversionsByOrganizationSince.mockResolvedValue(0);
    usageRepo.getMonthlyConversions.mockResolvedValue([]);

    const result = await service.getUsageStats(USER_ID, ORG_ID);

    const starterPlan = PLAN_CATALOGUE.find((p) => p.tier === PlanTier.STARTER)!;
    expect(result.plan.tier).toBe(PlanTier.STARTER);
    expect(result.plan.name).toBe(starterPlan.name);
    expect(result.screens.max).toBe(starterPlan.maxScreensPerMonth);
    expect(result.projects.max).toBe(starterPlan.maxProjects);
    expect(result.storage.maxGb).toBe(starterPlan.storageGb);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Case 2: PROFESSIONAL subscription → correct limits
  // ─────────────────────────────────────────────────────────────────────────────
  it('Case 2: returns PROFESSIONAL plan limits for active PROFESSIONAL subscription', async () => {
    usageRepo.findActiveSubscription.mockResolvedValue(
      makeSubscription({ planTier: PlanTier.PROFESSIONAL, planName: 'Professional' }),
    );
    usageRepo.countProjectsByOrganization.mockResolvedValue(5);
    usageRepo.countConversionsByOrganizationSince.mockResolvedValue(42);
    usageRepo.getMonthlyConversions.mockResolvedValue([]);

    const result = await service.getUsageStats(USER_ID, ORG_ID);

    const proPlan = PLAN_CATALOGUE.find((p) => p.tier === PlanTier.PROFESSIONAL)!;
    expect(result.plan.tier).toBe(PlanTier.PROFESSIONAL);
    expect(result.screens.max).toBe(proPlan.maxScreensPerMonth); // 100
    expect(result.projects.max).toBe(proPlan.maxProjects); // -1 (unlimited)
    expect(result.storage.maxGb).toBe(proPlan.storageGb); // 50
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Case 3: screens.used reflects countConversionsByOrganizationSince
  // ─────────────────────────────────────────────────────────────────────────────
  it('Case 3: screens.used = 0 when no conversions in period', async () => {
    usageRepo.findActiveSubscription.mockResolvedValue(makeSubscription());
    usageRepo.countProjectsByOrganization.mockResolvedValue(1);
    usageRepo.countConversionsByOrganizationSince.mockResolvedValue(0);
    usageRepo.getMonthlyConversions.mockResolvedValue([]);

    const result = await service.getUsageStats(USER_ID, ORG_ID);

    expect(result.screens.used).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Case 4: screens.used = 8 when 8 conversions exist
  // ─────────────────────────────────────────────────────────────────────────────
  it('Case 4: screens.used = 8 when countConversionsByOrganizationSince returns 8', async () => {
    usageRepo.findActiveSubscription.mockResolvedValue(makeSubscription());
    usageRepo.countProjectsByOrganization.mockResolvedValue(1);
    usageRepo.countConversionsByOrganizationSince.mockResolvedValue(8);
    usageRepo.getMonthlyConversions.mockResolvedValue([]);

    const result = await service.getUsageStats(USER_ID, ORG_ID);

    expect(result.screens.used).toBe(8);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Case 5: monthlyConversions — forwarded from repo with correct shape
  // ─────────────────────────────────────────────────────────────────────────────
  it('Case 5: monthlyConversions are forwarded from repository with correct shape', async () => {
    const mockMonthly = [
      { month: 'Apr', count: 2 },
      { month: 'May', count: 6 },
      { month: 'Jun', count: 3 },
    ];

    usageRepo.findActiveSubscription.mockResolvedValue(makeSubscription());
    usageRepo.countProjectsByOrganization.mockResolvedValue(1);
    usageRepo.countConversionsByOrganizationSince.mockResolvedValue(11);
    usageRepo.getMonthlyConversions.mockResolvedValue(mockMonthly);

    const result = await service.getUsageStats(USER_ID, ORG_ID);

    expect(result.monthlyConversions).toHaveLength(3);
    expect(result.monthlyConversions[0]).toEqual({ month: 'Apr', count: 2 });
    expect(result.monthlyConversions[2]).toEqual({ month: 'Jun', count: 3 });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Case 6: projects.used reflects countProjectsByOrganization
  // ─────────────────────────────────────────────────────────────────────────────
  it('Case 6: projects.used matches countProjectsByOrganization for orgId', async () => {
    usageRepo.findActiveSubscription.mockResolvedValue(makeSubscription());
    usageRepo.countProjectsByOrganization.mockResolvedValue(3);
    usageRepo.countConversionsByOrganizationSince.mockResolvedValue(0);
    usageRepo.getMonthlyConversions.mockResolvedValue([]);

    const result = await service.getUsageStats(USER_ID, ORG_ID);

    expect(result.projects.used).toBe(3);
    expect(usageRepo.countProjectsByOrganization).toHaveBeenCalledWith(ORG_ID);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Case 7: storage.usedGb is always 0 (pending real tracking implementation)
  // ─────────────────────────────────────────────────────────────────────────────
  it('Case 7: storage.usedGb returns 0 (real tracking not yet implemented)', async () => {
    usageRepo.findActiveSubscription.mockResolvedValue(makeSubscription());
    usageRepo.countProjectsByOrganization.mockResolvedValue(1);
    usageRepo.countConversionsByOrganizationSince.mockResolvedValue(5);
    usageRepo.getMonthlyConversions.mockResolvedValue([]);

    const result = await service.getUsageStats(USER_ID, ORG_ID);

    // This is a known limitation: storage tracking is not yet implemented.
    // When real storage tracking is added, update this test accordingly.
    expect(result.storage.usedGb).toBe(0);
    expect(result.storage.maxGb).toBe(5); // Starter plan = 5 GB
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Case 8: Enterprise plan → unlimited limits (-1)
  // ─────────────────────────────────────────────────────────────────────────────
  it('Case 8: ENTERPRISE plan returns unlimited limits (-1) for screens, projects, storage', async () => {
    usageRepo.findActiveSubscription.mockResolvedValue(
      makeSubscription({ planTier: PlanTier.ENTERPRISE, planName: 'Enterprise' }),
    );
    usageRepo.countProjectsByOrganization.mockResolvedValue(20);
    usageRepo.countConversionsByOrganizationSince.mockResolvedValue(500);
    usageRepo.getMonthlyConversions.mockResolvedValue([]);

    const result = await service.getUsageStats(USER_ID, ORG_ID);

    expect(result.plan.tier).toBe(PlanTier.ENTERPRISE);
    expect(result.screens.max).toBe(-1);
    expect(result.projects.max).toBe(-1);
    expect(result.storage.maxGb).toBe(-1);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Case 9: countConversionsByOrganizationSince is called with periodStart from subscription
  // ─────────────────────────────────────────────────────────────────────────────
  it('Case 9: uses subscription currentPeriodStart for conversion count period boundary', async () => {
    const periodStart = new Date('2026-09-01T00:00:00.000Z');
    usageRepo.findActiveSubscription.mockResolvedValue(
      makeSubscription({ currentPeriodStart: periodStart }),
    );
    usageRepo.countProjectsByOrganization.mockResolvedValue(1);
    usageRepo.countConversionsByOrganizationSince.mockResolvedValue(4);
    usageRepo.getMonthlyConversions.mockResolvedValue([]);

    await service.getUsageStats(USER_ID, ORG_ID);

    expect(usageRepo.countConversionsByOrganizationSince).toHaveBeenCalledWith(ORG_ID, periodStart);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Case 10: monthlyConversions returns empty array when no historical data
  // ─────────────────────────────────────────────────────────────────────────────
  it('Case 10: monthlyConversions returns empty array when repository returns empty', async () => {
    usageRepo.findActiveSubscription.mockResolvedValue(null);
    usageRepo.countProjectsByOrganization.mockResolvedValue(0);
    usageRepo.countConversionsByOrganizationSince.mockResolvedValue(0);
    usageRepo.getMonthlyConversions.mockResolvedValue([]);

    const result = await service.getUsageStats(USER_ID, ORG_ID);

    expect(result.monthlyConversions).toEqual([]);
  });
});
