import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CreateMenuItemDto, UpdateMenuItemDto } from '../../presentation/dto/menu.dto';
import { NavNode } from './navigation.service';
import { ApplicationContext, MenuItemStatus, MenuItemType } from '../../domain/enums/menu.enums';
import {
  IMenuBuilderRepository,
  MENU_BUILDER_REPOSITORY,
} from '../../domain/interfaces/menu-builder.repository.interface';

@Injectable()
export class MenuBuilderService {
  constructor(
    @Inject(MENU_BUILDER_REPOSITORY)
    private readonly menuBuilderRepo: IMenuBuilderRepository,
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
      requiredPermissions: itemPermsMap.get(item.id) || [],
    }));

    return this.buildTree(nodes);
  }

  async createMenuItem(dto: CreateMenuItemDto): Promise<NavNode> {
    const id = `item_${randomUUID().slice(0, 8)}`;

    if (dto.parentId) {
      const parent = await this.menuBuilderRepo.findMenuItemById(dto.parentId);
      if (!parent) {
        throw new NotFoundException({ code: 'PARENT_NOT_FOUND', message: `Parent menu item '${dto.parentId}' not found` });
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
        key: dto.key.trim(),
        application: dto.application,
        label: dto.label.trim(),
        type: dto.type || MenuItemType.PAGE,
        icon: dto.icon || 'Folder',
        route: dto.route || null,
        parentId: dto.parentId || null,
        order: dto.order ?? 0,
        visibility: dto.visibility ?? true,
        status: dto.status || MenuItemStatus.ACTIVE,
      },
      dto.permissions,
    );

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
      requiredPermissions: dto.permissions || [],
    };
  }

  async updateMenuItem(id: string, dto: UpdateMenuItemDto): Promise<NavNode> {
    const item = await this.menuBuilderRepo.findMenuItemById(id);
    if (!item) {
      throw new NotFoundException({ code: 'MENU_ITEM_NOT_FOUND', message: `Menu item '${id}' not found` });
    }

    let newParentId = item.parentId;
    if (dto.parentId !== undefined) {
      if (dto.parentId === id) {
        throw new BadRequestException({ code: 'SELF_PARENTING_FORBIDDEN', message: 'An item cannot be its own parent' });
      }
      if (dto.parentId !== null) {
        const parent = await this.menuBuilderRepo.findMenuItemById(dto.parentId);
        if (!parent) {
          throw new NotFoundException({ code: 'PARENT_NOT_FOUND', message: `Parent menu item '${dto.parentId}' not found` });
        }
        if (parent.application !== item.application) {
          throw new BadRequestException({
            code: 'CROSS_APPLICATION_PARENT_FORBIDDEN',
            message: `Parent menu item belongs to '${parent.application}' and cannot be parent of a '${item.application}' item`,
          });
        }
        const descendants = await this.menuBuilderRepo.getDescendantIds(id);
        if (descendants.includes(dto.parentId)) {
          throw new BadRequestException({ code: 'DESCENDANT_PARENTING_FORBIDDEN', message: 'An item cannot become a child of its own descendant' });
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
        status: dto.status,
      },
      dto.permissions,
    );

    const currentPerms = await this.menuBuilderRepo.findMenuItemPermissions(id);

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
      requiredPermissions: currentPerms,
    };
  }

  async deleteMenuItem(id: string): Promise<void> {
    const item = await this.menuBuilderRepo.findMenuItemById(id);
    if (!item) {
      throw new NotFoundException({ code: 'MENU_ITEM_NOT_FOUND', message: `Menu item '${id}' not found` });
    }

    const childCount = await this.menuBuilderRepo.countChildren(id);
    if (childCount > 0) {
      throw new BadRequestException({
        code: 'CANNOT_DELETE_PARENT',
        message: 'Cannot delete a menu item with children.',
      });
    }

    await this.menuBuilderRepo.deleteMenuItem(id);
  }

  async reorderMenuItems(items: Array<{ id: string; order: number }>): Promise<void> {
    await this.menuBuilderRepo.reorderMenuItems(items);
  }

  async moveMenuItem(
    id: string,
    parentId: string | null,
    targetOrder?: number,
    targetId?: string,
    placement?: 'before' | 'after' | 'inside',
  ): Promise<NavNode> {
    const item = await this.menuBuilderRepo.findMenuItemById(id);
    if (!item) {
      throw new NotFoundException({ code: 'MENU_ITEM_NOT_FOUND', message: `Menu item '${id}' not found` });
    }

    const oldParentId = item.parentId;
    let newParentId: string | null = parentId;

    if (targetId) {
      const targetItem = await this.menuBuilderRepo.findMenuItemById(targetId);
      if (!targetItem) {
        throw new NotFoundException({ code: 'TARGET_NOT_FOUND', message: `Target menu item '${targetId}' not found` });
      }

      if (targetItem.application !== item.application) {
        throw new BadRequestException({
          code: 'CROSS_APPLICATION_PARENT_FORBIDDEN',
          message: 'Cannot move item across different applications',
        });
      }

      if (placement === 'inside') {
        newParentId = targetId;
      } else {
        newParentId = targetItem.parentId;
      }
    }

    if (newParentId !== undefined) {
      if (newParentId === id) {
        throw new BadRequestException({ code: 'SELF_PARENTING_FORBIDDEN', message: 'An item cannot be its own parent' });
      }
      if (newParentId !== null) {
        const parentDoc = await this.menuBuilderRepo.findMenuItemById(newParentId);
        if (!parentDoc) {
          throw new NotFoundException({ code: 'PARENT_NOT_FOUND', message: `Parent menu item '${newParentId}' not found` });
        }
        if (parentDoc.application !== item.application) {
          throw new BadRequestException({
            code: 'CROSS_APPLICATION_PARENT_FORBIDDEN',
            message: `Parent menu item belongs to '${parentDoc.application}' and cannot be parent of a '${item.application}' item`,
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
    }

    await this.menuBuilderRepo.updateMenuItem(id, { parentId: newParentId });

    // Recalculate order for newParentId siblings
    const siblings = await this.menuBuilderRepo.findSiblings(item.application, newParentId);

    const otherSiblings = siblings.filter((s) => s.id !== id);
    let insertIndex = otherSiblings.length;

    if (targetId && placement) {
      const tIdx = otherSiblings.findIndex((s) => s.id === targetId);
      if (tIdx !== -1) {
        if (placement === 'before') insertIndex = tIdx;
        else if (placement === 'after') insertIndex = tIdx + 1;
        else if (placement === 'inside') insertIndex = otherSiblings.length;
      }
    } else if (targetOrder !== undefined) {
      insertIndex = Math.max(0, Math.min(targetOrder, otherSiblings.length));
    }

    otherSiblings.splice(insertIndex, 0, item);

    const ordersToUpdate = otherSiblings.map((s, i) => ({ id: s.id, order: i }));
    await this.menuBuilderRepo.updateOrders(ordersToUpdate);

    // Normalize order for oldParentId siblings if parent changed
    if (oldParentId !== newParentId) {
      const oldSiblings = await this.menuBuilderRepo.findSiblings(item.application, oldParentId);
      const oldOrdersToUpdate = oldSiblings.map((s, i) => ({ id: s.id, order: i }));
      await this.menuBuilderRepo.updateOrders(oldOrdersToUpdate);
    }

    const currentPerms = await this.menuBuilderRepo.findMenuItemPermissions(id);

    return {
      id: item.id,
      key: item.key,
      application: item.application,
      label: item.label,
      type: item.type,
      icon: item.icon,
      route: item.route,
      parentId: newParentId,
      order: insertIndex,
      visibility: item.visibility,
      status: item.status,
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
}
