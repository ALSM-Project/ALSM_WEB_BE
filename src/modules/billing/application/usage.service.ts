import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  BILLING_USAGE_REPOSITORY,
  IBillingUsageRepository,
} from '../domain/billing.repository.interface';
import { PLAN_CATALOGUE } from '../domain/billing.types';

@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  constructor(
    @Inject(BILLING_USAGE_REPOSITORY)
    private readonly usageRepo: IBillingUsageRepository,
  ) {}

  async getUsageStats(userId: string, organizationId: string) {
    let targetOrgId = organizationId;

    // Check organization quota & contract first for enterprise organizations
    const orgQuota = this.usageRepo.findOrganizationQuota
      ? await this.usageRepo.findOrganizationQuota(organizationId)
      : null;

    let planTier: string = 'STARTER';
    let planName: string = 'Starter';
    let maxScreens: number = 10;
    let maxPrograms: number = 5;
    let maxProjects: number = 1;
    let maxStorageGb: number = 5;
    let contractNumber: string | undefined = undefined;
    let isContractPlan: boolean = false;
    let subscription: any = null;

    if (orgQuota && !orgQuota.isTrial) {
      if (orgQuota.organizationId) {
        targetOrgId = orgQuota.organizationId;
      }
      planTier = orgQuota.planTier;
      planName = orgQuota.planName;
      maxScreens = orgQuota.maxScreens;
      maxPrograms = orgQuota.maxPrograms ?? 50;
      maxProjects = orgQuota.maxProjects;
      maxStorageGb = orgQuota.maxStorageGb;
      contractNumber = orgQuota.contractNumber;
      isContractPlan = true;
    } else {
      subscription = await this.usageRepo.findActiveSubscription(userId);

      const isPaidSub =
        subscription &&
        (subscription.status as string) === 'ACTIVE' &&
        subscription.planTier !== 'STARTER' &&
        (subscription.planTier as string) !== 'TRIAL';

      if (isPaidSub) {
        const planDef = PLAN_CATALOGUE.find((p) => p.tier === subscription.planTier);
        planTier = planDef?.tier || subscription.planTier;
        planName = planDef?.name || subscription.planName;
        maxScreens = planDef?.maxScreensPerMonth ?? 10;
        maxPrograms = 50;
        maxProjects = planDef?.maxProjects ?? 1;
        maxStorageGb = planDef?.storageGb ?? 5;
      } else if (orgQuota) {
        if (orgQuota.organizationId) {
          targetOrgId = orgQuota.organizationId;
        }
        planTier = orgQuota.planTier;
        planName = orgQuota.planName;
        maxScreens = orgQuota.maxScreens;
        maxPrograms = orgQuota.maxPrograms ?? 5;
        maxProjects = orgQuota.maxProjects;
        maxStorageGb = orgQuota.maxStorageGb;
        contractNumber = orgQuota.contractNumber;
        isContractPlan = !orgQuota.isTrial;
      } else {
        const planDef = subscription
          ? PLAN_CATALOGUE.find((p) => p.tier === subscription.planTier)
          : PLAN_CATALOGUE[0];
        planTier = planDef?.tier || 'STARTER';
        planName = planDef?.name || 'Starter';
        maxScreens = planDef?.maxScreensPerMonth ?? 10;
        maxPrograms = 5;
        maxProjects = planDef?.maxProjects ?? 1;
        maxStorageGb = planDef?.storageGb ?? 5;
      }
    }

    const projectCount = await this.usageRepo.countProjectsByOrganization(targetOrgId);
    const programCount = this.usageRepo.countProgramsByOrganization
      ? await this.usageRepo.countProgramsByOrganization(targetOrgId)
      : 0;

    const periodStart = subscription?.currentPeriodStart || new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const conversionCount = await this.usageRepo.countConversionsByOrganizationSince(
      targetOrgId,
      periodStart,
    );

    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const formattedMonthly = await this.usageRepo.getMonthlyConversions(
      targetOrgId,
      sixMonthsAgo,
    );

    return {
      plan: {
        tier: planTier,
        name: planName,
        contractNumber,
        isContractPlan,
      },
      screens: {
        used: conversionCount,
        max: maxScreens,
      },
      programs: {
        used: programCount,
        max: maxPrograms,
      },
      projects: {
        used: projectCount,
        max: maxProjects,
      },
      storage: {
        usedGb: 0,
        maxGb: maxStorageGb,
      },
      monthlyConversions: formattedMonthly,
    };
  }
}
