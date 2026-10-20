import { Injectable, Optional } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { Subscription, SubscriptionDocument } from '../subscription.schema';
import { Project, ProjectDocument } from '../../../projects/infrastructure/project.schema';
import {
  ConversionJob,
  ConversionJobDocument,
} from '../../../conversions/infrastructure/conversion-job.schema';
import {
  Organization,
  OrganizationDocument,
} from '../../../organizations/infrastructure/organization.schema';
import {
  EngagementType,
  EngagementTypeDocument,
} from '../../../organizations/infrastructure/engagement-type.schema';
import { ScreenDocument } from '../../../conversions/infrastructure/screen.schema';
import {
  IBillingUsageRepository,
  OrganizationQuotaProps,
  SubscriptionProps,
} from '../../domain/billing.repository.interface';
import { SubscriptionStatus } from '../../domain/billing.types';

@Injectable()
export class MongoBillingUsageRepository implements IBillingUsageRepository {
  constructor(
    @InjectModel(Subscription.name) private readonly subscriptionModel: Model<SubscriptionDocument>,
    @InjectModel(Project.name) private readonly projectModel: Model<ProjectDocument>,
    @InjectModel(ConversionJob.name) private readonly conversionModel: Model<ConversionJobDocument>,
    @Optional() @InjectModel(Organization.name) private readonly orgModel?: Model<OrganizationDocument>,
    @Optional() @InjectModel(EngagementType.name) private readonly engagementModel?: Model<EngagementTypeDocument>,
    @Optional() @InjectModel(ScreenDocument.name) private readonly screenModel?: Model<ScreenDocument>,
    @Optional() @InjectConnection() private readonly connection?: Connection,
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

  async countProgramsByOrganization(organizationId: string): Promise<number> {
    if (!this.screenModel) return 0;
    try {
      const projects = await this.projectModel
        .find({
          organizationId: new Types.ObjectId(organizationId),
          deletedAt: null,
        })
        .select('_id');
      const projectIds = projects.map((p) => p._id.toString());
      if (projectIds.length === 0) return 0;
      return await this.screenModel.countDocuments({
        projectId: { $in: projectIds },
        sourceType: { $in: ['COBOL', 'RPG'] },
      });
    } catch {
      return 0;
    }
  }

  async countConversionsByOrganizationSince(
    organizationId: string,
    sinceDate: Date,
  ): Promise<number> {
    return this.conversionModel.countDocuments({
      organizationId: new Types.ObjectId(organizationId),
      createdAt: { $gte: sinceDate },
    });
  }

  async getMonthlyConversions(
    organizationId: string,
    sinceDate: Date,
  ): Promise<Array<{ month: string; count: number }>> {
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

    const monthNames = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    return monthlyConversions.map((m) => ({
      month: monthNames[(m._id.month as number) - 1],
      count: m.count as number,
    }));
  }

  async findOrganizationQuota(organizationId: string): Promise<OrganizationQuotaProps | null> {
    if (!this.orgModel || !organizationId) {
      return null;
    }

    let org: OrganizationDocument | null = null;
    if (Types.ObjectId.isValid(organizationId)) {
      const objId = new Types.ObjectId(organizationId);
      org = await this.orgModel.findOne({
        $or: [
          { _id: objId },
          { 'members.userId': objId },
        ],
      }).exec();
    } else {
      org = await this.orgModel.findOne({
        'members.userId': organizationId,
      }).exec();
    }

    if (!org) return null;

    // 1. Authoritative check: Check contracts collection for any contract (active, signed, completed)
    if (this.connection?.db) {
      try {
        const contractsCol = this.connection.db.collection('contracts');
        const query: any = {
          $or: [
            ...(org._id ? [{ organizationId: org._id }, { organizationId: org._id.toString() }] : []),
            ...(Types.ObjectId.isValid(organizationId)
              ? [{ organizationId: new Types.ObjectId(organizationId) }, { organizationId: organizationId }]
              : [{ organizationId }]),
            ...(org.name ? [{ 'customer.companyName': org.name }, { organizationName: org.name }] : []),
          ],
        };
        const contracts = await contractsCol
          .find(query, {
            projection: {
              status: 1,
              lifecycleStatus: 1,
              activationStatus: 1,
              scope: 1,
              screensQuota: 1,
              maxScreens: 1,
              quotas: 1,
              contractCapacity: 1,
              programsQuota: 1,
              storageGb: 1,
            },
          })
          .toArray();

        const activeContract =
          contracts.find(
            (c) =>
              c.status === 'ACTIVE' ||
              c.status === 'Active' ||
              c.status === 'SIGNED' ||
              c.lifecycleStatus === 'COMPLETED' ||
              c.activationStatus === 'COMPLETED',
          ) || contracts[0];

        if (activeContract) {
          const screensQuota =
            activeContract.scope?.screensQuota ??
            activeContract.screensQuota ??
            activeContract.maxScreens ??
            activeContract.quotas?.screens ??
            activeContract.contractCapacity?.screenCapacity ??
            100;

          const programsQuota =
            activeContract.scope?.programsQuota ??
            activeContract.programsQuota ??
            activeContract.quotas?.programs ??
            activeContract.contractCapacity?.programCapacity ??
            50;

          const storageGb =
            activeContract.scope?.storageGb ??
            activeContract.storageGb ??
            activeContract.quotas?.storageGb ??
            activeContract.contractCapacity?.storageGb ??
            50;

          const projectCapacity =
            activeContract.scope?.projectsQuota ??
            activeContract.contractCapacity?.projectCapacity ??
            20;

          const planName =
            activeContract.plan ||
            activeContract.packageTitle ||
            activeContract.title ||
            'Enterprise Core Modernization';

          return {
            organizationId: org._id.toString(),
            planTier: 'ENTERPRISE',
            planName: planName,
            contractNumber: activeContract.contractNumber,
            maxScreens: screensQuota,
            maxPrograms: programsQuota,
            maxProjects: projectCapacity,
            maxStorageGb: storageGb,
            isTrial: false,
          };
        }
      } catch {
        // Fallback gracefully on query error
      }
    }

    // 2. Check if organization has direct contract capacity configured
    if (org.contractCapacity && org.contractCapacity.screenCapacity > 0) {
      return {
        organizationId: org._id.toString(),
        planTier: 'ENTERPRISE',
        planName: org.engagementType || 'Enterprise Contract',
        maxScreens: org.contractCapacity.screenCapacity,
        maxPrograms: org.contractCapacity.programCapacity || 50,
        maxProjects: org.contractCapacity.projectCapacity || 20,
        maxStorageGb: org.contractCapacity.storageGb || 50,
        isTrial: false,
      };
    }

    const engagementTypeName = org.engagementType || 'Trial';
    let engagementType: EngagementTypeDocument | null = null;
    if (this.engagementModel) {
      engagementType = await this.engagementModel.findOne({
        $or: [
          { name: engagementTypeName },
          { normalizedName: engagementTypeName.toLowerCase().trim() },
          { code: engagementTypeName.toUpperCase().trim() },
          { code: 'TRIAL' },
          { name: 'Trial' },
        ],
      }).exec();
    }

    const isTrial = org.status === 'TRIAL' || engagementTypeName.toLowerCase() === 'trial';

    if (isTrial) {
      // Prioritize admin-configured trial limits from EngagementType directly
      const trialScreens = engagementType?.trialLimits?.maxScreens ?? org.limits?.trialScreens ?? 10;
      const trialPrograms = engagementType?.trialLimits?.maxPrograms ?? org.limits?.trialPrograms ?? 5;
      const trialStorage = engagementType?.trialLimits?.maxStorageGb ?? org.limits?.trialStorageGb ?? 2;
      const maxProjects = org.limits?.maxProjects ?? 5;

      return {
        organizationId: org._id.toString(),
        planTier: engagementType?.code || 'TRIAL',
        planName: engagementType?.name || 'Trial',
        maxScreens: trialScreens,
        maxPrograms: trialPrograms,
        maxProjects: maxProjects,
        maxStorageGb: trialStorage,
        isTrial: true,
      };
    }

    const usageScreens = engagementType?.usageLimits?.maxScreens ?? 100;
    const usagePrograms = engagementType?.usageLimits?.maxPrograms ?? 50;
    const usageStorage = engagementType?.usageLimits?.maxStorageGb ?? 20;

    return {
      organizationId: org._id.toString(),
      planTier: engagementType?.code || 'ENTERPRISE',
      planName: engagementType?.name || engagementTypeName,
      maxScreens: usageScreens,
      maxPrograms: usagePrograms,
      maxProjects: org.limits?.maxProjects ?? 10,
      maxStorageGb: usageStorage,
      isTrial: false,
    };
  }
}
