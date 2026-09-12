import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MenuAnalytics, MenuAnalyticsDocument } from '../schemas/menu-analytics.schema';
import { IMenuAnalyticsRepository } from '../../domain/interfaces/menu-builder.repository.interface';

@Injectable()
export class MongoMenuAnalyticsRepository implements IMenuAnalyticsRepository {
  constructor(
    @InjectModel(MenuAnalytics.name) private readonly analyticsModel: Model<MenuAnalyticsDocument>,
  ) {}

  async trackInteraction(data: {
    userId: string;
    menuItemId: string;
    action: string;
    sessionId: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.analyticsModel.create({
      ...data,
      timestamp: new Date(),
    });
  }

  async getMenuStats(menuItemId: string, timeRange?: { start: Date; end: Date }): Promise<any[]> {
    const matchFilter: Record<string, unknown> = { menuItemId };
    if (timeRange) {
      matchFilter.timestamp = {
        $gte: timeRange.start,
        $lte: timeRange.end,
      };
    }

    return this.analyticsModel.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: '$action',
          count: { $sum: 1 },
          uniqueUsers: { $addToSet: '$userId' },
        },
      },
      {
        $project: {
          action: '$_id',
          count: 1,
          uniqueUserCount: { $size: '$uniqueUsers' },
        },
      },
    ]);
  }

  async getPopularItems(limit = 5): Promise<string[]> {
    const results = await this.analyticsModel.aggregate([
      { $group: { _id: '$menuItemId', totalClicks: { $sum: 1 } } },
      { $sort: { totalClicks: -1 } },
      { $limit: limit },
    ]);
    return results.map((r) => r._id);
  }

  async getUnderperformingItems(limit = 5): Promise<string[]> {
    const results = await this.analyticsModel.aggregate([
      { $group: { _id: '$menuItemId', totalClicks: { $sum: 1 } } },
      { $sort: { totalClicks: 1 } },
      { $limit: limit },
    ]);
    return results.map((r) => r._id);
  }
}
