import { Inject, Injectable } from '@nestjs/common';
import {
  IMenuRepository,
  IUserPreferencesRepository,
  MENU_REPOSITORY,
  USER_PREFERENCES_REPOSITORY,
  UserPreferencesProps,
} from '../../domain/interfaces/menu.repository.interface';
import { IMenuItem } from '../../domain/value-objects/menu-item.vo';

@Injectable()
export class MenuPersonalizationService {
  constructor(
    @Inject(MENU_REPOSITORY)
    private readonly menuRepository: IMenuRepository,
    @Inject(USER_PREFERENCES_REPOSITORY)
    private readonly userPreferencesRepository: IUserPreferencesRepository,
  ) {}

  /**
   * Lấy menu đã được cá nhân hóa cho user
   */
  async getPersonalizedMenu(role: string, userId: string): Promise<{
    pinnedItems: IMenuItem[];
    recentItems: IMenuItem[];
    suggestedItems: IMenuItem[];
    allItems: IMenuItem[];
  }> {
    // 1. Lấy menu gốc
    const menu = await this.menuRepository.findByRole(role);
    if (!menu) {
      return this.getDefaultMenu();
    }

    const allItems = menu.getItems();

    // 2. Lấy user preferences từ database
    const userPrefs = await this.getUserPreferences(userId);

    // 3. Lọc danh sách được ghim
    const pinnedItems = this.getPinnedItems(allItems, userPrefs.pinnedMenuItemIds);

    // 4. Lấy danh sách đã sử dụng gần đây
    const recentItems = this.getRecentItems(allItems, userPrefs.recentMenuItemIds);

    // 5. Gợi ý items (dựa trên usage count và pattern)
    const suggestedItems = this.getSuggestedItems(allItems, userPrefs);

    return {
      pinnedItems,
      recentItems,
      suggestedItems,
      allItems: this.applyPersonalization(allItems, userPrefs),
    };
  }

  /**
   * Ghim một menu item
   */
  async pinMenuItem(userId: string, itemId: string): Promise<void> {
    const preferences = await this.getUserPreferences(userId);
    if (!preferences.pinnedMenuItemIds.includes(itemId)) {
      preferences.pinnedMenuItemIds.push(itemId);
      await this.saveUserPreferences(userId, preferences);
    }
  }

  /**
   * Bỏ ghim một menu item
   */
  async unpinMenuItem(userId: string, itemId: string): Promise<void> {
    const preferences = await this.getUserPreferences(userId);
    preferences.pinnedMenuItemIds = preferences.pinnedMenuItemIds.filter(id => id !== itemId);
    await this.saveUserPreferences(userId, preferences);
  }

  /**
   * Ghi nhận một menu item đã được sử dụng
   */
  async trackMenuItemUsage(userId: string, itemId: string): Promise<void> {
    const preferences = await this.getUserPreferences(userId);

    // Cập nhật recent items
    preferences.recentMenuItemIds = [
      itemId,
      ...preferences.recentMenuItemIds.filter(id => id !== itemId),
    ].slice(0, 10);

    // Tăng usage count
    preferences.menuItemUsageCount[itemId] = (preferences.menuItemUsageCount[itemId] || 0) + 1;
    preferences.menuItemLastUsed[itemId] = new Date();

    await this.saveUserPreferences(userId, preferences);
  }

  /**
   * Lấy danh sách item được ghim
   */
  private getPinnedItems(allItems: IMenuItem[], pinnedIds: string[]): IMenuItem[] {
    const pinned: IMenuItem[] = [];
    const itemsMap = this.buildItemsMap(allItems);

    pinnedIds.forEach(id => {
      if (itemsMap.has(id)) {
        pinned.push({ ...itemsMap.get(id)!, isPinned: true });
      }
    });

    return pinned;
  }

  /**
   * Lấy danh sách item đã sử dụng gần đây
   */
  private getRecentItems(allItems: IMenuItem[], recentIds: string[]): IMenuItem[] {
    const itemsMap = this.buildItemsMap(allItems);
    return recentIds
      .map(id => itemsMap.get(id))
      .filter((item): item is IMenuItem => item !== undefined);
  }

  /**
   * Gợi ý items dựa trên usage pattern
   */
  private getSuggestedItems(allItems: IMenuItem[], preferences: UserPreferencesProps): IMenuItem[] {
    const itemsWithUsage = allItems
      .filter(item => {
        return (
          !preferences.recentMenuItemIds.includes(item.id) &&
          !preferences.pinnedMenuItemIds.includes(item.id)
        );
      })
      .map(item => ({
        ...item,
        usageScore: preferences.menuItemUsageCount[item.id] || 0,
      }))
      .sort((a, b) => b.usageScore - a.usageScore)
      .slice(0, 5);

    return itemsWithUsage;
  }

  /**
   * Áp dụng cá nhân hóa cho toàn bộ menu
   */
  private applyPersonalization(items: IMenuItem[], preferences: UserPreferencesProps): IMenuItem[] {
    return items
      .filter(item => !preferences.hiddenMenuItemIds.includes(item.id))
      .map(item => {
        const isPinned = preferences.pinnedMenuItemIds.includes(item.id);
        const usageCount = preferences.menuItemUsageCount[item.id] || 0;
        const lastUsedAt = preferences.menuItemLastUsed[item.id];

        const updated: IMenuItem = {
          ...item,
          isPinned,
          usageCount,
          lastUsedAt,
        };

        if (item.children) {
          updated.children = this.applyPersonalization(item.children, preferences);
        }
        return updated;
      });
  }

  private buildItemsMap(items: IMenuItem[]): Map<string, IMenuItem> {
    const map = new Map<string, IMenuItem>();
    const traverse = (itemList: IMenuItem[]) => {
      itemList.forEach(item => {
        map.set(item.id, item);
        if (item.children) {
          traverse(item.children);
        }
      });
    };
    traverse(items);
    return map;
  }

  public async getUserPreferences(userId: string): Promise<UserPreferencesProps> {
    const found = await this.userPreferencesRepository.findByUserId(userId);
    if (found) return found;

    return {
      userId,
      pinnedMenuItemIds: [],
      recentMenuItemIds: [],
      hiddenMenuItemIds: [],
      menuItemUsageCount: {},
      menuItemLastUsed: {},
      menuItemOrder: {},
      isSidebarCollapsed: false,
      themePreference: 'auto',
    };
  }

  public async saveUserPreferences(userId: string, preferences: UserPreferencesProps): Promise<void> {
    await this.userPreferencesRepository.save(userId, preferences);
  }

  private getDefaultMenu(): {
    pinnedItems: IMenuItem[];
    recentItems: IMenuItem[];
    suggestedItems: IMenuItem[];
    allItems: IMenuItem[];
  } {
    return {
      pinnedItems: [],
      recentItems: [],
      suggestedItems: [],
      allItems: [],
    };
  }
}
