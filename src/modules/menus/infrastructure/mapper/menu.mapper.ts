import { MenuEntity } from '../../domain/entities/menu.entity';
import { UserPreferencesProps } from '../../domain/interfaces/menu.repository.interface';
import { MenuDocument } from '../schemas/menu.schema';
import { UserPreferencesDocument } from '../schemas/user-preferences.schema';

export class MenuMapper {
  static toDomain(doc: MenuDocument | null): MenuEntity | null {
    if (!doc) return null;
    const raw = doc as unknown as { createdAt?: Date; updatedAt?: Date };
    return new MenuEntity({
      id: doc._id.toString(),
      role: doc.role,
      isDefault: doc.isDefault ?? false,
      items: doc.items || [],
      createdBy: doc.createdBy,
      createdAt: raw.createdAt || new Date(),
      updatedBy: doc.updatedBy,
      updatedAt: raw.updatedAt || new Date(),
    });
  }

  static userPreferencesToDomain(doc: UserPreferencesDocument | null): UserPreferencesProps | null {
    if (!doc) return null;

    const usageCountObj: Record<string, number> = {};
    if (doc.menuItemUsageCount && doc.menuItemUsageCount instanceof Map) {
      doc.menuItemUsageCount.forEach((val, key) => {
        usageCountObj[key] = val;
      });
    }

    const lastUsedObj: Record<string, Date> = {};
    if (doc.menuItemLastUsed && doc.menuItemLastUsed instanceof Map) {
      doc.menuItemLastUsed.forEach((val, key) => {
        lastUsedObj[key] = val;
      });
    }

    const orderObj: Record<string, number> = {};
    if (doc.menuItemOrder && doc.menuItemOrder instanceof Map) {
      doc.menuItemOrder.forEach((val, key) => {
        orderObj[key] = val;
      });
    }

    return {
      userId: doc.userId,
      pinnedMenuItemIds: doc.pinnedMenuItemIds || [],
      recentMenuItemIds: doc.recentMenuItemIds || [],
      hiddenMenuItemIds: doc.hiddenMenuItemIds || [],
      menuItemUsageCount: usageCountObj,
      menuItemLastUsed: lastUsedObj,
      menuItemOrder: orderObj,
      isSidebarCollapsed: doc.isSidebarCollapsed ?? false,
      themePreference: doc.themePreference || 'auto',
    };
  }
}
