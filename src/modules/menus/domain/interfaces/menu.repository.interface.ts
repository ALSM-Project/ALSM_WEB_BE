import { MenuEntity, MenuProps } from '../entities/menu.entity';
import { IMenuItem } from '../value-objects/menu-item.vo';

export const MENU_REPOSITORY = Symbol('MENU_REPOSITORY');
export const USER_PREFERENCES_REPOSITORY = Symbol('USER_PREFERENCES_REPOSITORY');
export const MENU_ANALYTICS_REPOSITORY = Symbol('MENU_ANALYTICS_REPOSITORY');

export interface UserPreferencesProps {
  userId: string;
  pinnedMenuItemIds: string[];
  recentMenuItemIds: string[];
  hiddenMenuItemIds: string[];
  menuItemUsageCount: Record<string, number>;
  menuItemLastUsed: Record<string, Date>;
  menuItemOrder: Record<string, number>;
  isSidebarCollapsed: boolean;
  themePreference: 'auto' | 'light' | 'dark';
}

export interface IMenuRepository {
  findByRole(role: string): Promise<MenuEntity | null>;
  createOrUpdateMenu(props: MenuProps): Promise<MenuEntity>;
  findAll(): Promise<MenuEntity[]>;
}

export interface IUserPreferencesRepository {
  findByUserId(userId: string): Promise<UserPreferencesProps | null>;
  save(userId: string, preferences: Partial<UserPreferencesProps>): Promise<UserPreferencesProps>;
}
