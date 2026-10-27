import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CreateMenuItemDto, UpdateMenuItemDto } from '../../presentation/dto/menu.dto';
import { NavNode } from './navigation.service';
import { ApplicationContext, MenuItemStatus, MenuItemType } from '../../domain/enums/menu.enums';
import {
  IMenuBuilderRepository,
  MENU_BUILDER_REPOSITORY,
} from '../../domain/interfaces/menu-builder.repository.interface';
import { AUDIT_REPOSITORY, AuditRepository } from '../../../audit/domain/audit.repository';

@Injectable()
export class MenuBuilderService {
  constructor(
    @Inject(MENU_BUILDER_REPOSITORY)
    private readonly menuBuilderRepo: IMenuBuilderRepository,
    @Optional()
    @Inject(AUDIT_REPOSITORY)
    private readonly audit?: AuditRepository,
  ) {}

  async getAdminMenuTree(app: ApplicationContext): Promise<NavNode[]> {
    const menuItems = await this.menuBuilderRepo.findMenuItemsByApp(app);
    const itemIds = menuItems.map((m) => m.id);

    const itemPermsMap = await this.menuBuilderRepo.findMenuItemPermissionsByItemIds(itemIds);

    const nodes: NavNode[] = menuItems.map((item) => ({
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
      openInNewTab: item.openInNewTab ?? false,
      hideParentLabel: item.hideParentLabel ?? false,
      contractTypeVisibility: item.contractTypeVisibility || 'ALL',
      featureKey: item.featureKey || null,
      description: item.description || null,
      requiredRoles: item.requiredRoles || [],
      requiredPermissions: itemPermsMap.get(item.id) || [],
    }));

    return this.buildTree(nodes);
  }

  async getMenuItemById(id: string): Promise<NavNode> {
    const item = await this.menuBuilderRepo.findMenuItemById(id);
    if (!item) {
      throw new NotFoundException({
        code: 'MENU_ITEM_NOT_FOUND',
        message: `Menu item '${id}' not found`,
      });
    }

    const perms = await this.menuBuilderRepo.findMenuItemPermissions(id);

    return {
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
      openInNewTab: item.openInNewTab ?? false,
      hideParentLabel: item.hideParentLabel ?? false,
      contractTypeVisibility: item.contractTypeVisibility || 'ALL',
      featureKey: item.featureKey || null,
      description: item.description || null,
      requiredRoles: item.requiredRoles || [],
      requiredPermissions: perms,
    };
  }

  async createMenuItem(dto: CreateMenuItemDto, actorId?: string): Promise<NavNode> {
    const id = `item_${randomUUID().slice(0, 8)}`;
    const normalizedKey = dto.key.trim();

    // Enforce unique menu key within the target application
    const existingKey = await this.menuBuilderRepo.findMenuItemByKey(normalizedKey, dto.application);
    if (existingKey) {
      throw new ConflictException({
        code: 'MENU_KEY_ALREADY_EXISTS',
        message: `Menu item with key '${normalizedKey}' already exists in application '${dto.application}'`,
      });
    }

    // Check duplicate route if specified
    if (this.menuBuilderRepo.findMenuItemsByApp && dto.route && dto.route.trim() && dto.type !== MenuItemType.GROUP) {
      const appItems = await this.menuBuilderRepo.findMenuItemsByApp(dto.application);
      const duplicate = (appItems || []).find((m) => m.route && m.route.trim() === dto.route!.trim());
      if (duplicate) {
        throw new ConflictException({
          code: 'DUPLICATE_MENU_ROUTE',
          message: `Route '${dto.route}' is already configured for menu '${duplicate.label}' (${duplicate.id})`,
        });
      }
    }

    if (dto.parentId) {
      const parent = await this.menuBuilderRepo.findMenuItemById(dto.parentId);
      if (!parent) {
        throw new NotFoundException({
          code: 'PARENT_NOT_FOUND',
          message: `Parent menu item '${dto.parentId}' not found`,
        });
      }
      if (parent.application !== dto.application) {
        throw new BadRequestException({
          code: 'CROSS_APPLICATION_PARENT_FORBIDDEN',
          message: `Parent menu item belongs to '${parent.application}' and cannot be parent of a '${dto.application}' item`,
        });
      }
    }

    if (dto.permissions && dto.permissions.length > 0) {
      const invalidKeys = await this.menuBuilderRepo.getInvalidPermissionKeys(dto.permissions);
      if (invalidKeys.length > 0) {
        throw new BadRequestException({
          code: 'INVALID_PERMISSIONS',
          message: `One or more required permission keys do not exist in the system catalog: ${invalidKeys.join(', ')}`,
        });
      }
    }

    const menuItem = await this.menuBuilderRepo.createMenuItem(
      {
        id,
        key: normalizedKey,
        application: dto.application,
        label: dto.label.trim(),
        type: dto.type || MenuItemType.PAGE,
        icon: dto.icon || 'Folder',
        route: dto.route || null,
        parentId: dto.parentId || null,
        order: dto.order ?? 0,
        visibility: dto.visibility ?? true,
        status: dto.status || MenuItemStatus.ACTIVE,
        openInNewTab: dto.openInNewTab ?? false,
        hideParentLabel: dto.hideParentLabel ?? false,
        contractTypeVisibility: dto.contractTypeVisibility || 'ALL',
        featureKey: dto.featureKey || null,
        description: dto.description || null,
        requiredRoles: dto.requiredRoles || [],
      },
      dto.permissions,
    );

    if (this.audit) {
      await this.audit.append({
        actorUserId: actorId,
        action: 'MENU_ITEM_CREATED',
        resourceType: 'menu_item',
        resourceId: menuItem.id,
        metadata: {
          key: menuItem.key,
          label: menuItem.label,
          application: menuItem.application,
        },
      });
    }

    return {
      id: menuItem.id,
      key: menuItem.key,
      application: menuItem.application,
      label: menuItem.label,
      type: menuItem.type,
      icon: menuItem.icon,
      route: menuItem.route,
      parentId: menuItem.parentId,
      order: menuItem.order,
      visibility: menuItem.visibility,
      status: menuItem.status,
      openInNewTab: menuItem.openInNewTab ?? false,
      hideParentLabel: menuItem.hideParentLabel ?? false,
      contractTypeVisibility: menuItem.contractTypeVisibility || 'ALL',
      featureKey: menuItem.featureKey || null,
      description: menuItem.description || null,
      requiredRoles: menuItem.requiredRoles || [],
      requiredPermissions: dto.permissions || [],
    };
  }

  async updateMenuItem(id: string, dto: UpdateMenuItemDto, actorId?: string): Promise<NavNode> {
    const item = await this.menuBuilderRepo.findMenuItemById(id);
    if (!item) {
      throw new NotFoundException({
        code: 'MENU_ITEM_NOT_FOUND',
        message: `Menu item '${id}' not found`,
      });
    }

    if (dto.key && dto.key.trim() !== item.key) {
      const normalizedKey = dto.key.trim();
      const existingKey = await this.menuBuilderRepo.findMenuItemByKey(normalizedKey, item.application);
      if (existingKey && existingKey.id !== id) {
        throw new ConflictException({
          code: 'MENU_KEY_ALREADY_EXISTS',
          message: `Menu item with key '${normalizedKey}' already exists in application '${item.application}'`,
        });
      }
    }

    // Check duplicate route if updated
    if (this.menuBuilderRepo.findMenuItemsByApp && dto.route && dto.route.trim() && dto.type !== MenuItemType.GROUP) {
      const appItems = await this.menuBuilderRepo.findMenuItemsByApp(item.application);
      const duplicate = (appItems || []).find((m) => m.id !== id && m.route && m.route.trim() === dto.route!.trim());
      if (duplicate) {
        throw new ConflictException({
          code: 'DUPLICATE_MENU_ROUTE',
          message: `Route '${dto.route}' is already configured for menu '${duplicate.label}' (${duplicate.id})`,
        });
      }
    }

    let newParentId = item.parentId;
    if (dto.parentId !== undefined) {
      if (dto.parentId === id) {
        throw new BadRequestException({
          code: 'SELF_PARENTING_FORBIDDEN',
          message: 'An item cannot be its own parent',
        });
      }
      if (dto.parentId !== null) {
        const parent = await this.menuBuilderRepo.findMenuItemById(dto.parentId);
        if (!parent) {
          throw new NotFoundException({
            code: 'PARENT_NOT_FOUND',
            message: `Parent menu item '${dto.parentId}' not found`,
          });
        }
        if (parent.application !== item.application) {
          throw new BadRequestException({
            code: 'CROSS_APPLICATION_PARENT_FORBIDDEN',
            message: `Parent menu item belongs to '${parent.application}' and cannot be parent of a '${item.application}' item`,
          });
        }
        const descendants = await this.menuBuilderRepo.getDescendantIds(id);
        if (descendants.includes(dto.parentId)) {
          throw new BadRequestException({
            code: 'DESCENDANT_PARENTING_FORBIDDEN',
            message: 'An item cannot become a child of its own descendant',
          });
        }
      }
      newParentId = dto.parentId;
    }

    if (dto.permissions !== undefined && dto.permissions.length > 0) {
      const invalidKeys = await this.menuBuilderRepo.getInvalidPermissionKeys(dto.permissions);
      if (invalidKeys.length > 0) {
        throw new BadRequestException({
          code: 'INVALID_PERMISSIONS',
          message: `One or more required permission keys do not exist in the system catalog: ${invalidKeys.join(', ')}`,
        });
      }
    }

    const updated = await this.menuBuilderRepo.updateMenuItem(
      id,
      {
        key: dto.key !== undefined ? dto.key.trim() : undefined,
        label: dto.label !== undefined ? dto.label.trim() : undefined,
        type: dto.type,
        icon: dto.icon,
        route: dto.route,
        parentId: newParentId,
        order: dto.order,
        visibility: dto.visibility,
        status:
          dto.status !== undefined
            ? dto.status
            : dto.visibility !== undefined
            ? dto.visibility
              ? MenuItemStatus.ACTIVE
              : MenuItemStatus.INACTIVE
            : undefined,
        openInNewTab: dto.openInNewTab,
        hideParentLabel: dto.hideParentLabel,
        contractTypeVisibility: dto.contractTypeVisibility,
        featureKey: dto.featureKey,
        description: dto.description,
        requiredRoles: dto.requiredRoles,
      },
      dto.permissions,
    );

    const currentPerms = await this.menuBuilderRepo.findMenuItemPermissions(id);

    if (this.audit) {
      await this.audit.append({
        actorUserId: actorId,
        action: 'MENU_ITEM_UPDATED',
        resourceType: 'menu_item',
        resourceId: updated!.id,
        metadata: {
          key: updated!.key,
          label: updated!.label,
          application: updated!.application,
        },
      });
    }

    return {
      id: updated!.id,
      key: updated!.key,
      application: updated!.application,
      label: updated!.label,
      type: updated!.type,
      icon: updated!.icon,
      route: updated!.route,
      parentId: updated!.parentId,
      order: updated!.order,
      visibility: updated!.visibility,
      status: updated!.status,
      openInNewTab: updated!.openInNewTab ?? false,
      hideParentLabel: updated!.hideParentLabel ?? false,
      contractTypeVisibility: updated!.contractTypeVisibility || 'ALL',
      featureKey: updated!.featureKey || null,
      description: updated!.description || null,
      requiredRoles: updated!.requiredRoles || [],
      requiredPermissions: currentPerms,
    };
  }

  async deleteMenuItem(id: string, actorId?: string): Promise<void> {
    const item = await this.menuBuilderRepo.findMenuItemById(id);
    if (!item) {
      throw new NotFoundException({
        code: 'MENU_ITEM_NOT_FOUND',
        message: `Menu item '${id}' not found`,
      });
    }

    const childCount = await this.menuBuilderRepo.countChildren(id);
    if (childCount > 0) {
      throw new BadRequestException({
        code: 'CANNOT_DELETE_PARENT',
        message: 'Cannot delete a menu item with children.',
      });
    }

    await this.menuBuilderRepo.deleteMenuItem(id);

    if (this.audit) {
      await this.audit.append({
        actorUserId: actorId,
        action: 'MENU_ITEM_DELETED',
        resourceType: 'menu_item',
        resourceId: id,
        metadata: {
          key: item.key,
          label: item.label,
          application: item.application,
        },
      });
    }
  }

  async reorderMenuItems(items: Array<{ id: string; order: number }>, actorId?: string): Promise<void> {
    const uniqueOrders = new Set(items.map((i) => i.order));
    if (uniqueOrders.size !== items.length) {
      throw new BadRequestException({
        code: 'DUPLICATE_ORDERS',
        message: 'Reordered items must contain unique sequential orders',
      });
    }

    await this.menuBuilderRepo.reorderMenuItems(items);

    if (this.audit) {
      await this.audit.append({
        actorUserId: actorId,
        action: 'MENU_ITEMS_REORDERED',
        resourceType: 'menu_item',
        resourceId: 'bulk',
        metadata: { count: String(items.length) },
      });
    }
  }

  async moveMenuItem(
    id: string,
    newParentId: string | null,
    targetOrder?: number,
    targetId?: string,
    placement?: 'before' | 'after' | 'inside',
    actorId?: string,
  ): Promise<NavNode> {
    const item = await this.menuBuilderRepo.findMenuItemById(id);
    if (!item) {
      throw new NotFoundException({
        code: 'MENU_ITEM_NOT_FOUND',
        message: `Menu item '${id}' not found`,
      });
    }

    if (newParentId === id) {
      throw new BadRequestException({
        code: 'SELF_PARENTING_FORBIDDEN',
        message: 'An item cannot be its own parent',
      });
    }

    if (newParentId !== null) {
      const parent = await this.menuBuilderRepo.findMenuItemById(newParentId);
      if (!parent) {
        throw new NotFoundException({
          code: 'PARENT_NOT_FOUND',
          message: `Parent menu item '${newParentId}' not found`,
        });
      }
      if (parent.application !== item.application) {
        throw new BadRequestException({
          code: 'CROSS_APPLICATION_PARENT_FORBIDDEN',
          message: `Parent menu item belongs to '${parent.application}' and cannot be parent of a '${item.application}' item`,
        });
      }
      const descendants = await this.menuBuilderRepo.getDescendantIds(id);
      if (descendants.includes(newParentId)) {
        throw new BadRequestException({
          code: 'DESCENDANT_PARENTING_FORBIDDEN',
          message: 'An item cannot become a child of its own descendant',
        });
      }
    }

    const siblings = await this.menuBuilderRepo.findSiblings(item.application, newParentId);
    const filteredSiblings = siblings.filter((s) => s.id !== id);

    let insertIndex = 0;

    if (targetId && placement) {
      const targetIdx = filteredSiblings.findIndex((s) => s.id === targetId);
      if (targetIdx !== -1) {
        if (placement === 'before') {
          insertIndex = targetIdx;
        } else if (placement === 'after') {
          insertIndex = targetIdx + 1;
        } else if (placement === 'inside') {
          insertIndex = filteredSiblings.length;
        }
      } else {
        insertIndex = filteredSiblings.length;
      }
    } else if (targetOrder !== undefined) {
      insertIndex = Math.max(0, Math.min(targetOrder, filteredSiblings.length));
    } else {
      insertIndex = filteredSiblings.length;
    }

    filteredSiblings.splice(insertIndex, 0, item);

    const reordered: Array<{ id: string; order: number }> = filteredSiblings.map((s, idx) => ({
      id: s.id,
      order: idx + 1,
    }));

    await this.menuBuilderRepo.updateOrders(reordered);

    if (item.parentId !== newParentId) {
      await this.menuBuilderRepo.updateMenuItem(id, { parentId: newParentId });
    }

    const currentPerms = await this.menuBuilderRepo.findMenuItemPermissions(id);

    if (this.audit) {
      await this.audit.append({
        actorUserId: actorId,
        action: 'MENU_ITEM_MOVED',
        resourceType: 'menu_item',
        resourceId: id,
        metadata: {
          key: item.key,
          previousParentId: item.parentId || 'root',
          newParentId: newParentId || 'root',
          newOrder: String(insertIndex + 1),
        },
      });
    }

    return {
      id: item.id,
      key: item.key,
      application: item.application,
      label: item.label,
      type: item.type,
      icon: item.icon,
      route: item.route,
      parentId: newParentId,
      order: insertIndex + 1,
      visibility: item.visibility,
      status: item.status,
      openInNewTab: item.openInNewTab ?? false,
      hideParentLabel: item.hideParentLabel ?? false,
      contractTypeVisibility: item.contractTypeVisibility || 'ALL',
      featureKey: item.featureKey || null,
      description: item.description || null,
      requiredRoles: item.requiredRoles || [],
      requiredPermissions: currentPerms,
    };
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
    return roots;
  }

  async saveMenuTree(application: ApplicationContext, tree: any[], actorId?: string): Promise<void> {
    const flatIncoming: Array<{
      id: string;
      label: string;
      icon?: string;
      path?: string | null;
      parentId: string | null;
      order: number;
      isVisible?: boolean;
    }> = [];

    const flatten = (items: any[], parentId: string | null = null) => {
      if (!Array.isArray(items)) return;
      items.forEach((item, index) => {
        if (!item || !item.id) return;
        flatIncoming.push({
          id: String(item.id),
          label: String(item.label || 'Untitled'),
          icon: item.icon ? String(item.icon) : undefined,
          path: item.path || item.route || null,
          parentId,
          order: typeof item.order === 'number' ? item.order : index + 1,
          isVisible: item.isVisible !== false,
        });
        if (item.children && Array.isArray(item.children)) {
          flatten(item.children, String(item.id));
        }
      });
    };

    flatten(tree);

    const incomingIds = new Set(flatIncoming.map((i) => i.id));
    const existingItems = await this.menuBuilderRepo.findMenuItemsByApp(application);

    // 1. Delete items that were removed
    for (const existing of existingItems) {
      if (!incomingIds.has(existing.id)) {
        await this.menuBuilderRepo.deleteMenuItem(existing.id);
        if (this.audit) {
          await this.audit.append({
            actorUserId: actorId,
            action: 'MENU_ITEM_DELETED',
            resourceType: 'menu_item',
            resourceId: existing.id,
            metadata: {
              key: existing.key,
              label: existing.label,
              application,
            },
          });
        }
      }
    }

    // 2. Update existing or create newly added items
    for (const item of flatIncoming) {
      const existing = existingItems.find((e) => e.id === item.id);
      if (existing) {
        await this.menuBuilderRepo.updateMenuItem(item.id, {
          label: item.label,
          icon: item.icon,
          route: item.path,
          parentId: item.parentId,
          order: item.order,
          visibility: item.isVisible,
        });
      } else {
        await this.menuBuilderRepo.createMenuItem({
          id: item.id,
          key: `${application.toLowerCase()}.${item.id}`,
          application,
          label: item.label,
          type: item.path ? MenuItemType.PAGE : MenuItemType.GROUP,
          icon: item.icon || 'Folder',
          route: item.path,
          parentId: item.parentId,
          order: item.order,
          visibility: item.isVisible,
          status: MenuItemStatus.ACTIVE,
        });
      }
    }
  }
}
