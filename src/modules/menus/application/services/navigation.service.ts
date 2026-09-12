import { Inject, Injectable } from '@nestjs/common';
import { ApplicationContext, MenuItemStatus } from '../../domain/enums/menu.enums';
import { EffectivePermissionsService } from '../../../rbac/application/effective-permissions.service';
import {
  INavigationRepository,
  NAVIGATION_REPOSITORY,
} from '../../domain/interfaces/menu-builder.repository.interface';

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
    @Inject(NAVIGATION_REPOSITORY)
    private readonly navigationRepo: INavigationRepository,
    private readonly effectivePermissionsService: EffectivePermissionsService,
  ) {}

  async getUserNavigation(userId: string, app: ApplicationContext): Promise<NavNode[]> {
    const userPermissions = await this.effectivePermissionsService.getEffectivePermissions(userId);

    const menuItems = await this.navigationRepo.findActiveVisibleMenuItems(app);
    const itemIds = menuItems.map((m) => m.id);

    const itemPermsMap = await this.navigationRepo.findMenuItemPermissionsByItemIds(itemIds);

    const permittedItems: NavNode[] = [];

    for (const item of menuItems) {
      const required = itemPermsMap.get(item.id) || [];
      const isPermitted = required.length === 0 || required.every((req) => userPermissions.includes(req));
      if (isPermitted) {
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

    const sortNodes = (items: NavNode[]) => {
      items.sort((a, b) => a.order - b.order);
      for (const item of items) {
        if (item.children && item.children.length > 0) {
          sortNodes(item.children);
        }
      }
    };

    sortNodes(roots);

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
