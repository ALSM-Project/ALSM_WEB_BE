import { IMenuItem, MegaMenuGroup } from '../value-objects/menu-item.vo';

export class MegaMenuService {
  /**
   * Xây dựng Mega Menu từ danh sách items
   */
  static buildMegaMenu(items: IMenuItem[]): {
    groups: MegaMenuGroup[];
    totalColumns: number;
  } {
    // 1. Lọc các item là Mega Menu
    const megaItems = items.filter(item => item.isMegaMenu);
    if (megaItems.length === 0) {
      return { groups: [], totalColumns: 0 };
    }

    // 2. Xây dựng các group
    const groups: MegaMenuGroup[] = [];

    megaItems.forEach(item => {
      if (item.megaMenuGroups && item.megaMenuGroups.length > 0) {
        // Sử dụng groups đã định nghĩa sẵn
        groups.push(...item.megaMenuGroups);
      } else if (item.children) {
        // Tự động tạo groups từ children
        const autoGroup: MegaMenuGroup = {
          id: `group_${item.id}`,
          title: item.label,
          icon: item.icon,
          items: item.children,
          order: 0,
        };
        groups.push(autoGroup);
      }
    });

    // 3. Sắp xếp groups
    const sortedGroups = groups.sort((a, b) => a.order - b.order);

    // 4. Tính số cột cần thiết
    const maxItems = Math.max(
      ...sortedGroups.map(g => g.items ? g.items.length : 0),
      1,
    );
    const totalColumns = Math.min(maxItems, 4); // Tối đa 4 cột

    return {
      groups: sortedGroups,
      totalColumns,
    };
  }

  /**
   * Render Mega Menu HTML (ví dụ cho frontend)
   */
  static renderMegaMenuHTML(groups: MegaMenuGroup[], totalColumns: number): string {
    const columnWidth = 100 / totalColumns;

    let html = '<div class="mega-menu" style="display:flex;flex-wrap:wrap;">';

    groups.forEach(group => {
      html += `
        <div class="mega-menu-column" style="flex: 0 0 ${columnWidth}%; padding: 1rem;">
          <h4 class="mega-menu-group-title">
            ${group.icon ? `<i class="${group.icon}"></i>` : ''}
            ${group.title}
          </h4>
          <ul class="mega-menu-group-items">
      `;

      (group.items || []).forEach(item => {
        html += `
          <li class="mega-menu-item">
            <a href="${item.path || '#'}" class="mega-menu-link">
              ${item.icon ? `<i class="${item.icon}"></i>` : ''}
              ${item.label}
              ${item.badge ? `<span class="badge" style="background:${item.badgeColor || '#007bff'}">${item.badge}</span>` : ''}
            </a>
            ${item.description ? `<small>${item.description}</small>` : ''}
          </li>
        `;
      });

      html += `
          </ul>
        </div>
      `;
    });

    html += '</div>';
    return html;
  }
}
