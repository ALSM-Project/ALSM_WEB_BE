import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MenuAnalytics, MenuAnalyticsDocument } from '../../infrastructure/schemas/menu-analytics.schema';

@Injectable()
export class MenuAnalyticsService {
  constructor(
    @InjectModel(MenuAnalytics.name)
    private readonly analyticsModel: Model<MenuAnalyticsDocument>,
  ) {}

  /**
   * Track menu interaction
   */
  async trackInteraction(data: {
    userId: string;
    menuItemId: string;
    action: 'click' | 'hover' | 'search';
    sessionId: string;
    metadata?: Record<string, unknown>;
  }) {
    const record = {
      ...data,
      timestamp: new Date(),
    };

    await this.analyticsModel.create(record);
  }

  /**
   * Lấy thống kê menu usage
   */
  async getMenuStats(menuItemId: string, timeRange?: { start: Date; end: Date }) {
    const matchFilter: Record<string, unknown> = { menuItemId };
    if (timeRange) {
      matchFilter.timestamp = {
        $gte: timeRange.start,
        $lte: timeRange.end,
      };
    }

    const stats = await this.analyticsModel.aggregate([
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

    return stats;
  }

  /**
   * Gợi ý cải thiện menu dựa trên analytics
   */
  async suggestImprovements(): Promise<{
    popularItems: string[];
    underperforming: string[];
    suggestions: string[];
  }> {
    const popularItems = await this.getPopularItems();
    const underperforming = await this.getUnderperformingItems();

    return {
      popularItems,
      underperforming,
      suggestions: this.generateSuggestions(popularItems, underperforming),
    };
  }

  private async getPopularItems(): Promise<string[]> {
    const results = await this.analyticsModel.aggregate([
      { $group: { _id: '$menuItemId', totalClicks: { $sum: 1 } } },
      { $sort: { totalClicks: -1 } },
      { $limit: 5 },
    ]);
    return results.map(r => r._id);
  }

  private async getUnderperformingItems(): Promise<string[]> {
    const results = await this.analyticsModel.aggregate([
      { $group: { _id: '$menuItemId', totalClicks: { $sum: 1 } } },
      { $sort: { totalClicks: 1 } },
      { $limit: 5 },
    ]);
    return results.map(r => r._id);
  }

  private generateSuggestions(popular: string[], underperforming: string[]): string[] {
    const suggestions: string[] = [];

    if (underperforming.length > 0) {
      suggestions.push(
        `Xem xét tối ưu hoặc sắp xếp lại các mục menu ít được truy cập: ${underperforming.join(', ')}`,
      );
    }

    if (popular.length > 0) {
      suggestions.push(
        `Đưa các mục phổ biến lên thanh truy cập nhanh: ${popular.join(', ')}`,
      );
    }

    return suggestions;
  }
}
