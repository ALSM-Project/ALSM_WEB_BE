import { Inject, Injectable } from '@nestjs/common';
import {
  IMenuRepository,
  MENU_REPOSITORY,
} from '../../domain/interfaces/menu.repository.interface';
import {
  IMenuItem,
  MenuPosition,
  NavigationLevel,
} from '../../domain/value-objects/menu-item.vo';
import { MenuPersonalizationService } from './personalization.service';

export interface MenuContext {
  role: string;
  organizationId?: string;
  projectId?: string;
  deviceType?: 'desktop' | 'tablet' | 'mobile';
  permissions?: string[];
  featureFlags?: Record<string, boolean>;
}

@Injectable()
export class GetPersonalizedMenuService {
  constructor(
    @Inject(MENU_REPOSITORY)
    private readonly menuRepository: IMenuRepository,
    private readonly personalizationService: MenuPersonalizationService,
  ) {}

  async execute(userId: string, context: MenuContext) {
    // 1. Lấy menu cơ bản theo role
    const baseMenu = await this.menuRepository.findByRole(context.role);
    if (!baseMenu) {
      return this.getFallbackMenu();
    }

    let items = baseMenu.getItems();

    // 2. Lọc theo permissions (nếu truyền vào)
    if (context.permissions) {
      items = this.filterByPermissions(items, context.permissions);
    }

    // 3. Lọc theo feature flags (nếu truyền vào)
    if (context.featureFlags) {
      items = this.filterByFeatureFlags(items, context.featureFlags);
    }

    // 4. Lọc theo device type (responsive)
    items = this.filterByDevice(items, context.deviceType || 'desktop');

    // 5. Áp dụng cá nhân hóa
    const personalized = await this.personalizationService.getPersonalizedMenu(
      context.role,
      userId,
    );

    // 6. Xây dựng cấu trúc điều hướng
    const navigation = {
      topNav: this.buildTopNav(items, personalized),
      sidebarNav: this.buildSidebarNav(items, personalized),
      secondaryNav: this.buildSecondaryNav(items, personalized),
      contextualNav: this.buildContextualNav(items),
      personalization: {
        pinnedItems: personalized.pinnedItems,
        recentItems: personalized.recentItems,
        suggestedItems: personalized.suggestedItems,
      },
      metadata: {
        totalItems: items.length,
        isDefault: baseMenu.isDefault(),
        lastUpdated: baseMenu.toProps().updatedAt,
      },
    };

    return navigation;
  }

  /**
   * Lọc items theo permissions
   */
  private filterByPermissions(items: IMenuItem[], permissions: string[]): IMenuItem[] {
    return items
      .filter(item => {
        if (!item.permissions || item.permissions.length === 0) {
          return true;
        }
        return item.permissions.some(p => permissions.includes(p));
      })
      .map(item => {
        if (item.children) {
          return {
            ...item,
            children: this.filterByPermissions(item.children, permissions),
          };
        }
        return item;
      });
  }

  /**
   * Lọc items theo feature flags
   */
  private filterByFeatureFlags(items: IMenuItem[], flags: Record<string, boolean>): IMenuItem[] {
    return items
      .filter(item => {
        if (!item.conditions || item.conditions.length === 0) {
          return true;
        }
        return item.conditions.every(condition => {
          if (condition.type === 'feature_flag') {
            return flags[condition.value as string] === true;
          }
          return true;
        });
      })
      .map(item => {
        if (item.children) {
          return {
            ...item,
            children: this.filterByFeatureFlags(item.children, flags),
          };
        }
        return item;
      });
  }

  /**
   * Lọc theo thiết bị
   */
  private filterByDevice(items: IMenuItem[], deviceType: string): IMenuItem[] {
    return items
      .filter(item => {
        if (deviceType === 'mobile' && item.hideOnMobile) return false;
        if (deviceType === 'tablet' && item.hideOnTablet) return false;
        return true;
      })
      .map(item => {
        if (item.children) {
          return {
            ...item,
            children: this.filterByDevice(item.children, deviceType),
          };
        }
        return item;
      });
  }

  /**
   * Xây dựng Top Navigation
   */
  private buildTopNav(items: IMenuItem[], personalized: any): IMenuItem[] {
    const topItems = items.filter(
      item =>
        item.level === NavigationLevel.GLOBAL &&
        item.position === MenuPosition.TOP &&
        item.isVisible,
    );

    const pinned = (personalized.pinnedItems || []).filter(
      (item: IMenuItem) => item.level === NavigationLevel.GLOBAL,
    );

    return [...pinned, ...topItems].slice(0, 10);
  }

  /**
   * Xây dựng Sidebar Navigation
   */
  private buildSidebarNav(items: IMenuItem[], personalized: any): IMenuItem[] {
    let sidebarItems = items.filter(
      item =>
        item.level === NavigationLevel.PRIMARY &&
        item.position === MenuPosition.LEFT &&
        item.isVisible,
    );

    const quickAccess = (personalized.recentItems || []).slice(0, 3);
    if (quickAccess.length > 0) {
      sidebarItems = [
        {
          id: 'quick-access',
          label: 'Quick Access',
          level: NavigationLevel.PRIMARY,
          position: MenuPosition.LEFT,
          children: quickAccess,
          isVisible: true,
        },
        ...sidebarItems,
      ];
    }

    return sidebarItems;
  }

  /**
   * Xây dựng Secondary Navigation (tabs)
   */
  private buildSecondaryNav(
    items: IMenuItem[],
    personalized: any,
  ): Record<string, IMenuItem[]> {
    const secondaryItems = items.filter(
      item => item.level === NavigationLevel.SECONDARY && item.isVisible,
    );

    const groups: Record<string, IMenuItem[]> = {};
    secondaryItems.forEach(item => {
      const key = item.parentId || 'default';
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(item);
    });

    Object.keys(groups).forEach(key => {
      groups[key] = groups[key].sort((a, b) => (a.order || 0) - (b.order || 0));
    });

    return groups;
  }

  /**
   * Xây dựng Contextual Navigation
   */
  private buildContextualNav(items: IMenuItem[]): IMenuItem[] {
    return items.filter(
      item => item.level === NavigationLevel.CONTEXTUAL && item.isVisible,
    );
  }

  private getFallbackMenu(): any {
    return {
      topNav: [],
      sidebarNav: [
        {
          id: 'dashboard',
          label: 'Dashboard',
          path: '/',
          icon: 'dashboard',
          level: NavigationLevel.PRIMARY,
          position: MenuPosition.LEFT,
          isVisible: true,
        },
        {
          id: 'projects',
          label: 'Dự án Modernization',
          path: '/projects',
          icon: 'folder',
          level: NavigationLevel.PRIMARY,
          position: MenuPosition.LEFT,
          isVisible: true,
        },
        {
          id: 'conversions',
          label: 'Chuyển đổi BMS/DSPF',
          path: '/conversions',
          icon: 'refresh-cw',
          level: NavigationLevel.PRIMARY,
          position: MenuPosition.LEFT,
          isVisible: true,
        },
        {
          id: 'billing',
          label: 'Gói dịch vụ & Billing',
          path: '/billing/pricing',
          icon: 'credit-card',
          level: NavigationLevel.PRIMARY,
          position: MenuPosition.LEFT,
          isVisible: true,
        },
      ],
      secondaryNav: {},
      contextualNav: [],
      personalization: {
        pinnedItems: [],
        recentItems: [],
        suggestedItems: [],
      },
      metadata: {
        totalItems: 4,
        isDefault: true,
        lastUpdated: new Date(),
      },
    };
  }
}
