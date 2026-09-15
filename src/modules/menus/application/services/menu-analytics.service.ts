import { Inject, Injectable } from '@nestjs/common';
import {
  IMenuAnalyticsRepository,
  MENU_ANALYTICS_REPOSITORY,
} from '../../domain/interfaces/menu-builder.repository.interface';

@Injectable()
export class MenuAnalyticsService {
  constructor(
    @Inject(MENU_ANALYTICS_REPOSITORY)
    private readonly analyticsRepo: IMenuAnalyticsRepository,
  ) {}

  async trackInteraction(data: {
    userId: string;
    menuItemId: string;
    action: 'click' | 'hover' | 'search';
    sessionId: string;
    metadata?: Record<string, unknown>;
  }) {
    await this.analyticsRepo.trackInteraction(data);
  }

  async getMenuStats(menuItemId: string, timeRange?: { start: Date; end: Date }) {
    return this.analyticsRepo.getMenuStats(menuItemId, timeRange);
  }

  async suggestImprovements(): Promise<{
    popularItems: string[];
    underperforming: string[];
    suggestions: string[];
  }> {
    const popularItems = await this.analyticsRepo.getPopularItems(5);
    const underperforming = await this.analyticsRepo.getUnderperformingItems(5);

    return {
      popularItems,
      underperforming,
      suggestions: this.generateSuggestions(popularItems, underperforming),
    };
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
