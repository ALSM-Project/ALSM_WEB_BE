import { Test, TestingModule } from '@nestjs/testing';
import { BillingService } from '../src/modules/billing/application/billing.service';
import {
  SUBSCRIPTION_REPOSITORY,
  INVOICE_REPOSITORY,
  PLAN_REPOSITORY,
} from '../src/modules/billing/domain/billing.repository.interface';
import { PlanTier, SubscriptionStatus } from '../src/modules/billing/domain/billing.types';

describe('BillingService', () => {
  let service: BillingService;

  const mockPlan = {
    id: 'plan-1',
    tier: PlanTier.PROFESSIONAL,
    name: 'Professional',
    description: 'Pro plan description',
    monthlyPriceVnd: 499000,
    annualPriceVnd: 399000,
    isPopular: true,
    maxProjects: -1,
    maxScreensPerMonth: 100,
    storageGb: 50,
    features: ['Unlimited Projects', '100 Screens/mo'],
  };

  const mockSubscription = {
    id: 'sub-1',
    userId: 'user-123',
    organizationId: 'org-1',
    planTier: PlanTier.PROFESSIONAL,
    planName: 'Professional',
    status: SubscriptionStatus.TRIAL,
    amountVnd: 0,
    trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
  };

  beforeEach(async () => {
    const mockSubscriptionRepo = {
      findActiveByUser: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(mockSubscription),
    };

    const mockInvoiceRepo = {
      findRecentByUser: jest.fn().mockResolvedValue([]),
    };

    const mockPlanRepo = {
      findAllActive: jest.fn().mockResolvedValue([mockPlan]),
      findByTier: jest.fn().mockResolvedValue(mockPlan),
      seedDefaults: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        {
          provide: SUBSCRIPTION_REPOSITORY,
          useValue: mockSubscriptionRepo,
        },
        {
          provide: INVOICE_REPOSITORY,
          useValue: mockInvoiceRepo,
        },
        {
          provide: PLAN_REPOSITORY,
          useValue: mockPlanRepo,
        },
      ],
    }).compile();

    service = module.get<BillingService>(BillingService);
  });

  it('should return active subscription plans (getPlans)', async () => {
    const plans = await service.getPlans();

    expect(plans).toBeDefined();
    expect(Array.isArray(plans)).toBe(true);
    expect(plans.length).toBeGreaterThan(0);
    expect(plans[0].name).toBe('Professional');
  });

  it('should activate 14-day free trial successfully (activateTrial)', async () => {
    const result = await service.activateTrial('user-123', 'org-1');

    expect(result).toBeDefined();
    expect(result.status).toBe(SubscriptionStatus.TRIAL);
    expect(result.planName).toBe('Professional');
  });
});
