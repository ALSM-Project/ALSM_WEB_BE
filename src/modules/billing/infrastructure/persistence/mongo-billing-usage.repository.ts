import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Subscription, SubscriptionDocument } from '../subscription.schema';
import { Project, ProjectDocument } from '../../../projects/infrastructure/project.schema';
import { ConversionJob, ConversionJobDocument } from '../../../conversions/infrastructure/conversion-job.schema';
import { IBillingUsageRepository, SubscriptionProps } from '../../domain/billing.repository.interface';
import { SubscriptionStatus } from '../../domain/billing.types';

@Injectable()
export class MongoBillingUsageRepository implements IBillingUsageRepository {
  constructor(
    @InjectModel(Subscription.name) private readonly subscriptionModel: Model<SubscriptionDocument>,
    @InjectModel(Project.name) private readonly projectModel: Model<ProjectDocument>,
    @InjectModel(ConversionJob.name) private readonly conversionModel: Model<ConversionJobDocument>,
  ) {}

  async findActiveSubscription(userId: string): Promise<SubscriptionProps | null> {
    const doc = await this.subscriptionModel.findOne({
      userId: new Types.ObjectId(userId),
      status: { $in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL] },
    });
    if (!doc) return null;
    return {
      id: doc._id.toString(),
      userId: doc.userId.toString(),
      organizationId: doc.organizationId.toString(),
      planTier: doc.planTier,
      planName: doc.planName,
      billingCycle: doc.billingCycle,
      status: doc.status,
      amountVnd: doc.amountVnd,
      trialEndsAt: doc.trialEndsAt,
      currentPeriodStart: doc.currentPeriodStart,
      currentPeriodEnd: doc.currentPeriodEnd,
      cancelledAt: doc.cancelledAt,
      cancelReason: doc.cancelReason,
      cancelFeedback: doc.cancelFeedback,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  async countProjectsByOrganization(organizationId: string): Promise<number> {
    return this.projectModel.countDocuments({
      organizationId: new Types.ObjectId(organizationId),
      deletedAt: null,
    });
  }

  async countConversionsByOrganizationSince(organizationId: string, sinceDate: Date): Promise<number> {
    return this.conversionModel.countDocuments({
      organizationId: new Types.ObjectId(organizationId),
      createdAt: { $gte: sinceDate },
    });
  }

  async getMonthlyConversions(organizationId: string, sinceDate: Date): Promise<Array<{ month: string; count: number }>> {
    const monthlyConversions = await this.conversionModel.aggregate([
      {
        $match: {
          organizationId: new Types.ObjectId(organizationId),
          createdAt: { $gte: sinceDate },
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
    return monthlyConversions.map((m) => ({
      month: monthNames[(m._id.month as number) - 1],
      count: m.count as number,
    }));
  }
}
