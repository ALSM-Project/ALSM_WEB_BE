import { ApplicationContext, MenuItemStatus, MenuItemType } from '../enums/menu.enums';

export interface IMenuItemData {
  id: string;
  key: string;
  application: ApplicationContext;
  label: string;
  type: MenuItemType;
  icon: string;
  route: string | null;
  parentId: string | null;
  order: number;
  visibility: boolean;
  status: MenuItemStatus;
}

export interface IMenuBuilderRepository {
  findMenuItemsByApp(app: ApplicationContext): Promise<IMenuItemData[]>;
  findMenuItemById(id: string): Promise<IMenuItemData | null>;
  findMenuItemPermissionsByItemIds(itemIds: string[]): Promise<Map<string, string[]>>;
  findMenuItemPermissions(menuItemId: string): Promise<string[]>;
  createMenuItem(data: Partial<IMenuItemData>, permissions?: string[]): Promise<IMenuItemData>;
  updateMenuItem(id: string, data: Partial<IMenuItemData>, permissions?: string[]): Promise<IMenuItemData | null>;
  deleteMenuItem(id: string): Promise<void>;
  countChildren(parentId: string): Promise<number>;
  getDescendantIds(nodeId: string): Promise<string[]>;
  reorderMenuItems(items: Array<{ id: string; order: number }>): Promise<void>;
  findSiblings(app: ApplicationContext, parentId: string | null): Promise<IMenuItemData[]>;
  updateOrders(orders: Array<{ id: string; order: number }>): Promise<void>;
  validatePermissionsExist(permissionKeys: string[]): Promise<boolean>;
  getInvalidPermissionKeys(permissionKeys: string[]): Promise<string[]>;
}

export interface IMenuAnalyticsRepository {
  trackInteraction(data: {
    userId: string;
    menuItemId: string;
    action: string;
    sessionId: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;

  getMenuStats(menuItemId: string, timeRange?: { start: Date; end: Date }): Promise<Array<{ action: string; count: number; uniqueUserCount: number }>>;
  getPopularItems(limit?: number): Promise<string[]>;
  getUnderperformingItems(limit?: number): Promise<string[]>;
}

export interface INavigationRepository {
  findActiveVisibleMenuItems(app: ApplicationContext): Promise<IMenuItemData[]>;
  findMenuItemPermissionsByItemIds(itemIds: string[]): Promise<Map<string, string[]>>;
}

export const MENU_BUILDER_REPOSITORY = Symbol('MENU_BUILDER_REPOSITORY');
export const MENU_ANALYTICS_REPOSITORY = Symbol('MENU_ANALYTICS_REPOSITORY');
export const NAVIGATION_REPOSITORY = Symbol('NAVIGATION_REPOSITORY');
