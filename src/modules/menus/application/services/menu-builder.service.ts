import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'crypto';
import { MenuItem, MenuItemDocument, ApplicationContext, MenuItemType, MenuItemStatus } from '../../infrastructure/schemas/menu-item.schema';
import { MenuItemPermission, MenuItemPermissionDocument } from '../../infrastructure/schemas/menu-item-permission.schema';
import { CreateMenuItemDto, UpdateMenuItemDto } from '../../presentation/dto/menu.dto';
import { NavNode } from './navigation.service';

@Injectable()
export class MenuBuilderService {
  constructor(
    @InjectModel(MenuItem.name) private readonly menuItemModel: Model<MenuItemDocument>,
    @InjectModel(MenuItemPermission.name) private readonly menuItemPermissionModel: Model<MenuItemPermissionDocument>,
  ) {}

  async getAdminMenuTree(app: ApplicationContext): Promise<NavNode[]> {
    const menuItems = await this.menuItemModel.find({ application: app }).sort({ order: 1 }).exec();
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
      const parent = await this.menuItemModel.findOne({ id: dto.parentId }).exec();
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

    const menuItem = new this.menuItemModel({
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
    });

    await menuItem.save();

    if (dto.permissions && dto.permissions.length > 0) {
      const permDocs = dto.permissions.map((pKey) => ({ menuItemId: id, permissionKey: pKey }));
      await this.menuItemPermissionModel.insertMany(permDocs);
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
      requiredPermissions: dto.permissions || [],
    };
  }

  async updateMenuItem(id: string, dto: UpdateMenuItemDto): Promise<NavNode> {
    const item = await this.menuItemModel.findOne({ id }).exec();
    if (!item) {
      throw new NotFoundException({ code: 'MENU_ITEM_NOT_FOUND', message: `Menu item '${id}' not found` });
    }

    if (dto.parentId !== undefined) {
      if (dto.parentId === id) {
        throw new BadRequestException({ code: 'SELF_PARENTING_FORBIDDEN', message: 'An item cannot be its own parent' });
      }
      if (dto.parentId !== null) {
        const parent = await this.menuItemModel.findOne({ id: dto.parentId }).exec();
        if (!parent) {
          throw new NotFoundException({ code: 'PARENT_NOT_FOUND', message: `Parent menu item '${dto.parentId}' not found` });
        }
        if (parent.application !== item.application) {
          throw new BadRequestException({
            code: 'CROSS_APPLICATION_PARENT_FORBIDDEN',
            message: `Parent menu item belongs to '${parent.application}' and cannot be parent of a '${item.application}' item`,
          });
        }
        // Check descendant cycle
        const descendants = await this.getDescendantIds(id);
        if (descendants.includes(dto.parentId)) {
          throw new BadRequestException({ code: 'DESCENDANT_PARENTING_FORBIDDEN', message: 'An item cannot become a child of its own descendant' });
        }
      }
      item.parentId = dto.parentId;
    }

    if (dto.key !== undefined) item.key = dto.key.trim();
    if (dto.label !== undefined) item.label = dto.label.trim();
    if (dto.type !== undefined) item.type = dto.type;
    if (dto.icon !== undefined) item.icon = dto.icon;
    if (dto.route !== undefined) item.route = dto.route;
    if (dto.order !== undefined) item.order = dto.order;
    if (dto.visibility !== undefined) item.visibility = dto.visibility;
    if (dto.status !== undefined) item.status = dto.status;

    await item.save();

    if (dto.permissions !== undefined) {
      await this.menuItemPermissionModel.deleteMany({ menuItemId: id }).exec();
      if (dto.permissions.length > 0) {
        const permDocs = dto.permissions.map((pKey) => ({ menuItemId: id, permissionKey: pKey }));
        await this.menuItemPermissionModel.insertMany(permDocs);
      }
    }

    const currentPerms = await this.menuItemPermissionModel.find({ menuItemId: id }).exec();

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
      requiredPermissions: currentPerms.map((cp) => cp.permissionKey),
    };
  }

  async deleteMenuItem(id: string): Promise<void> {
    const item = await this.menuItemModel.findOne({ id }).exec();
    if (!item) {
      throw new NotFoundException({ code: 'MENU_ITEM_NOT_FOUND', message: `Menu item '${id}' not found` });
    }

    const childCount = await this.menuItemModel.countDocuments({ parentId: id }).exec();
    if (childCount > 0) {
      throw new BadRequestException({
        code: 'CANNOT_DELETE_PARENT',
        message: 'Cannot delete a menu item with children.',
      });
    }

    await this.menuItemModel.deleteOne({ id }).exec();
    await this.menuItemPermissionModel.deleteMany({ menuItemId: id }).exec();
  }

  async reorderMenuItems(items: Array<{ id: string; order: number }>): Promise<void> {
    for (const item of items) {
      await this.menuItemModel.updateOne({ id: item.id }, { $set: { order: item.order } }).exec();
    }
  }

  async moveMenuItem(id: string, parentId: string | null, targetOrder?: number): Promise<NavNode> {
    return this.updateMenuItem(id, { parentId, order: targetOrder });
  }

  private async getDescendantIds(nodeId: string): Promise<string[]> {
    const descendants: string[] = [];
    const queue = [nodeId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const children = await this.menuItemModel.find({ parentId: current }).exec();
      for (const child of children) {
        descendants.push(child.id);
        queue.push(child.id);
      }
    }

    return descendants;
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
