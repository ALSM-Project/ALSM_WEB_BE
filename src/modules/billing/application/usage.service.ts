import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Project, ProjectDocument } from '../../projects/infrastructure/project.schema';
import {
  ConversionJob,
  ConversionJobDocument,
} from '../../conversions/infrastructure/conversion-job.schema';
import {
  Subscription,
  SubscriptionDocument,
} from '../infrastructure/subscription.schema';
import {
  PLAN_CATALOGUE,
  SubscriptionStatus,
} from '../domain/billing.types';

@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  constructor(
    @InjectModel(Subscription.name) private readonly subscriptionModel: Model<SubscriptionDocument>,
    @InjectModel(Project.name) private readonly projectModel: Model<ProjectDocument>,
    @InjectModel(ConversionJob.name) private readonly conversionModel: Model<ConversionJobDocument>,
  ) {}

  async getUsageStats(userId: string, organizationId: string) {
    // Find the active subscription to determine plan limits
    const subscription = await this.subscriptionModel.findOne({
      userId: new Types.ObjectId(userId),
      status: { $in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL] },
    });

    const plan = subscription
      ? PLAN_CATALOGUE.find((p) => p.tier === subscription.planTier)
      : PLAN_CATALOGUE[0]; // Default to Starter if no sub

    // Count projects in the organization
    const projectCount = await this.projectModel.countDocuments({
      organizationId: new Types.ObjectId(organizationId),
      deletedAt: null,
    });

    // Count conversions in current billing period
    const periodStart = subscription?.currentPeriodStart || new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const conversionCount = await this.conversionModel.countDocuments({
      organizationId: new Types.ObjectId(organizationId),
      createdAt: { $gte: periodStart },
    });

    // Monthly conversion history (last 6 months)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const monthlyConversions = await this.conversionModel.aggregate([
      {
        $match: {
          organizationId: new Types.ObjectId(organizationId),
          createdAt: { $gte: sixMonthsAgo },
        },
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]);

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const formattedMonthly = monthlyConversions.map((m) => ({
      month: monthNames[(m._id.month as number) - 1],
      count: m.count as number,
    }));

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
