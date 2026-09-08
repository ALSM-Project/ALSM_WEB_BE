export enum NavigationLevel {
  GLOBAL = 'global',      // Thanh trên cùng - công cụ toàn cục
  PRIMARY = 'primary',    // Sidebar chính
  SECONDARY = 'secondary', // Tab/Sub-nav trong module
  CONTEXTUAL = 'contextual', // Context menu (click chuột phải)
}

export enum MenuPosition {
  TOP = 'top',           // Thanh trên cùng
  LEFT = 'left',         // Sidebar trái
  RIGHT = 'right',       // Sidebar phải
  BOTTOM = 'bottom',      // Footer/Thanh dưới
}

export interface MenuCondition {
  type: 'role' | 'permission' | 'custom' | 'feature_flag';
  value: string | Record<string, unknown>;
  operator: 'equals' | 'contains' | 'not_equals' | 'custom';
}

export interface MegaMenuGroup {
  id: string;
  title: string;
  icon?: string;
  items: IMenuItem[];
  order: number;
}

export interface IMenuItem {
  id: string;                    // ID duy nhất
  label: string;                 // Tên hiển thị
  icon?: string;                 // Icon
  path?: string;                 // Đường dẫn
  level: NavigationLevel;        // Cấp độ điều hướng
  position: MenuPosition;        // Vị trí hiển thị
  children?: IMenuItem[];
  parentId?: string;            // ID của parent (để quản lý cây)
  
  // Phân quyền nâng cao
  permissions?: string[];        // Danh sách quyền cần có
  conditions?: MenuCondition[];  // Điều kiện đặc biệt
  
  // Cá nhân hóa
  isPinnable?: boolean;          // Cho phép ghim
  isHidden?: boolean;           // Ẩn đi (mặc định)
  isPinned?: boolean;           // Đã được ghim
  usageCount?: number;          // Số lần sử dụng
  lastUsedAt?: Date;            // Lần cuối sử dụng
  
  // Hiển thị
  order?: number;               // Thứ tự sắp xếp
  isVisible: boolean;          // Hiển thị hay không
  badge?: string;              // Badge (ví dụ: "New", 10)
  badgeColor?: string;
  
  // Metadata
  groupName?: string;          // Nhóm (ví dụ: "Quản trị")
  description?: string;        // Mô tả
  target?: '_blank' | '_self'; // Mở trong tab mới
  queryParams?: Record<string, unknown>; // Query parameters
  fragment?: string;           // Anchor (#section)
  
  // Responsive
  hideOnMobile?: boolean;     // Ẩn trên mobile
  hideOnTablet?: boolean;     // Ẩn trên tablet
  
  // Mega Menu
  isMegaMenu?: boolean;        // Có phải Mega Menu không
  megaMenuColumns?: number;    // Số cột hiển thị
  megaMenuGroups?: MegaMenuGroup[]; // Nhóm trong Mega Menu
  
  // Audit
  createdBy?: string;
  createdAt?: Date;
  updatedBy?: string;
  updatedAt?: Date;
}
