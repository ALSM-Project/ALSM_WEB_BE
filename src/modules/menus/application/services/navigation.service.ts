import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MenuItem, MenuItemDocument, ApplicationContext, MenuItemStatus } from '../../infrastructure/schemas/menu-item.schema';
import { MenuItemPermission, MenuItemPermissionDocument } from '../../infrastructure/schemas/menu-item-permission.schema';
import { EffectivePermissionsService } from '../../../rbac/application/effective-permissions.service';

export interface NavNode {
  id: string;
  key: string;
  application: string;
  label: string;
  type: string;
  icon: string;
  route: string | null;
  parentId: string | null;
  order: number;
  visibility: boolean;
  status: string;
  requiredPermissions: string[];
  children?: NavNode[];
}

@Injectable()
export class NavigationService {
  constructor(
    @InjectModel(MenuItem.name) private readonly menuItemModel: Model<MenuItemDocument>,
    @InjectModel(MenuItemPermission.name) private readonly menuItemPermissionModel: Model<MenuItemPermissionDocument>,
    private readonly effectivePermissionsService: EffectivePermissionsService,
  ) {}

  async getUserNavigation(userId: string, app: ApplicationContext): Promise<NavNode[]> {
    const userPermissions = await this.effectivePermissionsService.getEffectivePermissions(userId);

    // Fetch active visible menu items for this application
    const menuItems = await this.menuItemModel
      .find({ application: app, visibility: true, status: MenuItemStatus.ACTIVE })
      .sort({ order: 1 })
      .exec();

    const itemIds = menuItems.map((m) => m.id);
    const itemPermissions = await this.menuItemPermissionModel
      .find({ menuItemId: { $in: itemIds } })
      .exec();

    const itemPermsMap = new Map<string, string[]>();
    for (const ip of itemPermissions) {
      const existing = itemPermsMap.get(ip.menuItemId) || [];
      existing.push(ip.permissionKey);
      itemPermsMap.set(ip.menuItemId, existing);
    }

    // Filter items: User MUST possess ALL required permissions
    const permittedItems: NavNode[] = [];
    const permittedIds = new Set<string>();

    for (const item of menuItems) {
      const required = itemPermsMap.get(item.id) || [];
      const isPermitted = required.length === 0 || required.every((req) => userPermissions.includes(req));
      if (isPermitted) {
        permittedIds.add(item.id);
        permittedItems.push({
          id: item.id,
          key: item.key,
          application: item.application,
          label: item.label,
          type: item.type,
          icon: item.icon,
          route: item.route,
          parentId: item.parentId,
          order: item.order,
          visibility: item.visibility,
          status: item.status,
          requiredPermissions: required,
        });
      }
    }

    return this.buildTree(permittedItems);
  }

  private buildTree(nodes: NavNode[]): NavNode[] {
    const nodeMap = new Map<string, NavNode>();
    const roots: NavNode[] = [];

    for (const node of nodes) {
      nodeMap.set(node.id, { ...node, children: [] });
    }

    for (const node of nodeMap.values()) {
      if (node.parentId && nodeMap.has(node.parentId)) {
        nodeMap.get(node.parentId)!.children!.push(node);
      } else {
        roots.push(node);
      }
    }

    // Sort children by order
    const sortNodes = (items: NavNode[]) => {
      items.sort((a, b) => a.order - b.order);
      for (const item of items) {
        if (item.children && item.children.length > 0) {
          sortNodes(item.children);
        }
      }
    };

    sortNodes(roots);

    // Prune GROUP nodes that have 0 children (Section 15: Parent/Child Navigation Rule)
    const pruneEmptyGroups = (items: NavNode[]): NavNode[] => {
      return items.filter((item) => {
        if (item.children && item.children.length > 0) {
          item.children = pruneEmptyGroups(item.children);
        }
        if (item.type === 'GROUP' && (!item.children || item.children.length === 0)) {
          return false;
        }
        return true;
      });
    };

    return pruneEmptyGroups(roots);
  }
}

