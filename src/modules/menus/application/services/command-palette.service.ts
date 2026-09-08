import { Inject, Injectable } from '@nestjs/common';
import {
  IMenuRepository,
  MENU_REPOSITORY,
} from '../../domain/interfaces/menu.repository.interface';
import { IMenuItem } from '../../domain/value-objects/menu-item.vo';

export interface CommandItem {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  category: string;
  keywords: string[];
  action: 'navigate' | 'action' | 'quick_action';
  data: Record<string, unknown>;
  shortcut?: string[];
}

@Injectable()
export class CommandPaletteService {
  constructor(
    @Inject(MENU_REPOSITORY)
    private readonly menuRepository: IMenuRepository,
  ) {}

  /**
   * Lấy danh sách commands cho user
   */
  async getCommands(userId: string, role: string): Promise<CommandItem[]> {
    // 1. Lấy menu items
    const menu = await this.menuRepository.findByRole(role);
    const items = menu ? menu.getItems() : [];

    // 2. Chuyển đổi thành commands
    const commands: CommandItem[] = [];
    if (items.length > 0) {
      this.extractCommands(items, commands, 'Navigation');
    } else {
      // Direct navigation fallbacks
      commands.push(
        {
          id: 'nav-dashboard',
          label: 'Dashboard Overview',
          description: 'Trang tổng quan hệ thống',
          icon: 'home',
          category: 'Navigation',
          keywords: ['dashboard', 'home', 'overview', 'trang chủ'],
          action: 'navigate',
          data: { path: '/' },
        },
        {
          id: 'nav-projects',
          label: 'Dự án Modernization',
          description: 'Quản lý dự án chuyển đổi legacy',
          icon: 'folder',
          category: 'Navigation',
          keywords: ['projects', 'dự án', 'legacy', 'modernization'],
          action: 'navigate',
          data: { path: '/projects' },
        },
        {
          id: 'nav-billing',
          label: 'Gói dịch vụ & Giao dịch',
          description: 'Nâng cấp gói cước và xem lịch sử',
          icon: 'credit-card',
          category: 'Navigation',
          keywords: ['billing', 'subscription', 'thanh toán', 'qr', 'nâng cấp'],
          action: 'navigate',
          data: { path: '/billing/pricing' },
        },
      );
    }

    // 3. Thêm quick actions
    commands.push(
      {
        id: 'create-project',
        label: 'Tạo Dự án Chuyển đổi Mới',
        description: 'Bắt đầu một dự án modernization hệ thống cũ',
        icon: 'plus',
        category: 'Actions',
        keywords: ['create', 'project', 'new', 'tạo', 'dự án'],
        action: 'action',
        data: { route: '/projects/create' },
        shortcut: ['cmd', 'shift', 'n'],
      },
      {
        id: 'upload-file',
        label: 'Upload File Legacy (BMS / DSPF)',
        description: 'Tải lên màn hình BMS/DSPF hoặc COBOL để chuyển đổi',
        icon: 'upload',
        category: 'Actions',
        keywords: ['upload', 'file', 'bms', 'dspf', 'cobol', 'tải lên'],
        action: 'action',
        data: { route: '/upload' },
      },
      {
        id: 'upgrade-plan',
        label: 'Nâng cấp Gói dịch vụ VietQR',
        description: 'Nâng cấp lên Professional hoặc Enterprise',
        icon: 'zap',
        category: 'Billing',
        keywords: ['upgrade', 'billing', 'plan', 'nâng cấp', 'vietqr'],
        action: 'action',
        data: { route: '/billing/upgrade' },
      },
      {
        id: 'search-docs',
        label: 'Tra cứu Tài liệu Hướng dẫn',
        description: 'Xem hướng dẫn sử dụng ALSM Platform',
        icon: 'book',
        category: 'Help',
        keywords: ['docs', 'documentation', 'help', 'hướng dẫn', 'tài liệu'],
        action: 'action',
        data: { route: '/docs' },
        shortcut: ['cmd', 'shift', '?'],
      },
    );

    return commands;
  }

  /**
   * Tìm kiếm commands theo từ khóa
   */
  async searchCommands(query: string, userId: string, role: string): Promise<CommandItem[]> {
    const commands = await this.getCommands(userId, role);

    if (!query || query.trim() === '') {
      return commands.slice(0, 10);
    }

    const searchTerm = query.toLowerCase().trim();
    const results = commands
      .map(cmd => ({
        ...cmd,
        score: this.calculateScore(cmd, searchTerm),
      }))
      .filter(cmd => cmd.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 15);

    return results;
  }

  /**
   * Tính điểm matching cho command
   */
  private calculateScore(cmd: CommandItem, searchTerm: string): number {
    let score = 0;
    const searchParts = searchTerm.split(' ');

    searchParts.forEach(term => {
      if (cmd.label.toLowerCase().includes(term)) score += 10;
      if (cmd.description?.toLowerCase().includes(term)) score += 5;
      if (cmd.keywords.some(k => k.toLowerCase().includes(term))) score += 3;
      if (cmd.label.toLowerCase() === term) score += 20;
    });

    return score;
  }

  /**
   * Extract commands từ menu tree
   */
  private extractCommands(items: IMenuItem[], result: CommandItem[], category: string): void {
    items.forEach(item => {
      if (item.isVisible && item.path) {
        result.push({
          id: item.id,
          label: item.label,
          description: item.description,
          icon: item.icon,
          category: category,
          keywords: [item.label.toLowerCase(), ...(item.path?.split('/') || [])],
          action: 'navigate',
          data: {
            path: item.path,
            queryParams: item.queryParams,
            fragment: item.fragment,
            target: item.target || '_self',
          },
        });
      }

      if (item.children) {
        this.extractCommands(
          item.children,
          result,
          item.isMegaMenu ? category : item.label,
        );
      }
    });
  }
}
