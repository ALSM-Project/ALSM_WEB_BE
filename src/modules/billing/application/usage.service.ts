import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  BILLING_USAGE_REPOSITORY,
  IBillingUsageRepository,
} from '../domain/billing.repository.interface';
import {
  PLAN_CATALOGUE,
} from '../domain/billing.types';

@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  constructor(
    @Inject(BILLING_USAGE_REPOSITORY)
    private readonly usageRepo: IBillingUsageRepository,
  ) {}

  async getUsageStats(userId: string, organizationId: string) {
    const subscription = await this.usageRepo.findActiveSubscription(userId);

    const plan = subscription
      ? PLAN_CATALOGUE.find((p) => p.tier === subscription.planTier)
      : PLAN_CATALOGUE[0]; // Default to Starter if no sub

    const projectCount = await this.usageRepo.countProjectsByOrganization(organizationId);

    const periodStart = subscription?.currentPeriodStart || new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const conversionCount = await this.usageRepo.countConversionsByOrganizationSince(organizationId, periodStart);

    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const formattedMonthly = await this.usageRepo.getMonthlyConversions(organizationId, sixMonthsAgo);

    return {
      plan: {
        tier: plan?.tier,
        name: plan?.name,
      },
      screens: {
        used: conversionCount,
        max: plan?.maxScreensPerMonth ?? 10,
      },
      projects: {
        used: projectCount,
        max: plan?.maxProjects ?? 1,
      },
      storage: {
        usedGb: 0, // TODO: implement real storage tracking
        maxGb: plan?.storageGb ?? 5,
      },
      monthlyConversions: formattedMonthly,
    };
  }
}
