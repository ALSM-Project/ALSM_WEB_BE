import { IMenuItem, MenuPosition, NavigationLevel } from '../value-objects/menu-item.vo';

export class NavigationService {
  /**
   * Xây dựng cây điều hướng đa lớp
   */
  static buildNavigationTree(items: IMenuItem[]): {
    topNav: IMenuItem[];
    sidebarNav: IMenuItem[];
    secondaryNav: Record<string, IMenuItem[]>; // Key là module/context
  } {
    // Lọc theo level
    const topNav = items.filter(
      item => item.level === NavigationLevel.GLOBAL && item.isVisible,
    );
    const sidebarNav = items.filter(
      item => item.level === NavigationLevel.PRIMARY && item.isVisible,
    );
    const secondaryNav = items.filter(
      item => item.level === NavigationLevel.SECONDARY && item.isVisible,
    );

    // Xây dựng cây cha-con
    return {
      topNav: this.buildTree(topNav),
      sidebarNav: this.buildTree(sidebarNav),
      secondaryNav: this.buildSecondaryNav(secondaryNav),
    };
  }

  /**
   * Xây dựng cây menu cha-con
   */
  static buildTree(items: IMenuItem[]): IMenuItem[] {
    const itemMap = new Map<string, IMenuItem>();
    const roots: IMenuItem[] = [];

    // Tạo map
    items.forEach(item => {
      itemMap.set(item.id, { ...item, children: [] });
    });

    // Xây dựng cây
    items.forEach(item => {
      const node = itemMap.get(item.id)!;
      if (item.parentId && itemMap.has(item.parentId)) {
        const parent = itemMap.get(item.parentId)!;
        parent.children = parent.children || [];
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    });

    // Sắp xếp theo order
    return this.sortItems(roots);
  }

  /**
   * Xây dựng điều hướng thứ cấp theo module
   */
  static buildSecondaryNav(items: IMenuItem[]): Record<string, IMenuItem[]> {
    const result: Record<string, IMenuItem[]> = {};

    items.forEach(item => {
      const key = item.parentId || 'default';
      if (!result[key]) {
        result[key] = [];
      }
      result[key].push(item);
    });

    // Sắp xếp từng nhóm
    Object.keys(result).forEach(key => {
      result[key] = this.sortItems(result[key]);
    });

    return result;
  }

  /**
   * Sắp xếp items theo order
   */
  static sortItems(items: IMenuItem[]): IMenuItem[] {
    return items
      .sort((a, b) => (a.order || 0) - (b.order || 0))
      .map(item => {
        if (item.children && item.children.length > 0) {
          return { ...item, children: this.sortItems(item.children) };
        }
        return item;
      });
  }
}
