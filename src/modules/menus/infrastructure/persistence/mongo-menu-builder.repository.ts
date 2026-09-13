import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MenuItem, MenuItemDocument } from '../schemas/menu-item.schema';
import { MenuItemPermission, MenuItemPermissionDocument } from '../schemas/menu-item-permission.schema';
import { Permission, PermissionDocument } from '../../../rbac/infrastructure/schemas/permission.schema';
import { IMenuBuilderRepository, IMenuItemData } from '../../domain/interfaces/menu-builder.repository.interface';
import { ApplicationContext } from '../../domain/enums/menu.enums';

@Injectable()
export class MongoMenuBuilderRepository implements IMenuBuilderRepository {
  constructor(
    @InjectModel(MenuItem.name) private readonly menuItemModel: Model<MenuItemDocument>,
    @InjectModel(MenuItemPermission.name) private readonly menuItemPermissionModel: Model<MenuItemPermissionDocument>,
    @InjectModel(Permission.name) private readonly permissionModel: Model<PermissionDocument>,
  ) {}

  async findMenuItemsByApp(app: ApplicationContext): Promise<IMenuItemData[]> {
    const docs = await this.menuItemModel.find({ application: app }).sort({ order: 1 }).exec();
    return docs.map(this.toData);
  }

  async findMenuItemById(id: string): Promise<IMenuItemData | null> {
    const doc = await this.menuItemModel.findOne({ id }).exec();
    if (!doc) return null;
    return this.toData(doc);
  }

  async findMenuItemPermissionsByItemIds(itemIds: string[]): Promise<Map<string, string[]>> {
    const itemPermissions = await this.menuItemPermissionModel
      .find({ menuItemId: { $in: itemIds } })
      .exec();

    const map = new Map<string, string[]>();
    for (const ip of itemPermissions) {
      const existing = map.get(ip.menuItemId) || [];
      existing.push(ip.permissionKey);
      map.set(ip.menuItemId, existing);
    }
    return map;
  }

  async findMenuItemPermissions(menuItemId: string): Promise<string[]> {
    const perms = await this.menuItemPermissionModel.find({ menuItemId }).exec();
    return perms.map((p) => p.permissionKey);
  }

  async createMenuItem(data: Partial<IMenuItemData>, permissions?: string[]): Promise<IMenuItemData> {
    const created = new this.menuItemModel(data);
    const saved = await created.save();

    if (permissions && permissions.length > 0) {
      const permDocs = permissions.map((pKey) => ({ menuItemId: saved.id, permissionKey: pKey }));
      await this.menuItemPermissionModel.insertMany(permDocs);
    }

    return this.toData(saved);
  }

  async updateMenuItem(id: string, data: Partial<IMenuItemData>, permissions?: string[]): Promise<IMenuItemData | null> {
    const item = await this.menuItemModel.findOne({ id }).exec();
    if (!item) return null;

    if (data.key !== undefined) item.key = data.key;
    if (data.label !== undefined) item.label = data.label;
    if (data.type !== undefined) item.type = data.type;
    if (data.icon !== undefined) item.icon = data.icon;
    if (data.route !== undefined) item.route = data.route;
    if (data.parentId !== undefined) item.parentId = data.parentId;
    if (data.order !== undefined) item.order = data.order;
    if (data.visibility !== undefined) item.visibility = data.visibility;
    if (data.status !== undefined) item.status = data.status;

    await item.save();

    if (permissions !== undefined) {
      await this.menuItemPermissionModel.deleteMany({ menuItemId: id }).exec();
      if (permissions.length > 0) {
        const permDocs = permissions.map((pKey) => ({ menuItemId: id, permissionKey: pKey }));
        await this.menuItemPermissionModel.insertMany(permDocs);
      }
    }

    return this.toData(item);
  }

  async deleteMenuItem(id: string): Promise<void> {
    await this.menuItemModel.deleteOne({ id }).exec();
    await this.menuItemPermissionModel.deleteMany({ menuItemId: id }).exec();
  }

  async countChildren(parentId: string): Promise<number> {
    return this.menuItemModel.countDocuments({ parentId }).exec();
  }

  async getDescendantIds(nodeId: string): Promise<string[]> {
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

  async reorderMenuItems(items: Array<{ id: string; order: number }>): Promise<void> {
    for (const item of items) {
      await this.menuItemModel.updateOne({ id: item.id }, { $set: { order: item.order } }).exec();
    }
  }

  async findSiblings(app: ApplicationContext, parentId: string | null): Promise<IMenuItemData[]> {
    const docs = await this.menuItemModel
      .find({ application: app, parentId })
      .sort({ order: 1 })
      .exec();
    return docs.map(this.toData);
  }

  async updateOrders(orders: Array<{ id: string; order: number }>): Promise<void> {
    for (const item of orders) {
      await this.menuItemModel.updateOne({ id: item.id }, { $set: { order: item.order } }).exec();
    }
  }

  async validatePermissionsExist(permissionKeys: string[]): Promise<boolean> {
    const uniqueKeys = Array.from(new Set(permissionKeys.filter((k) => k !== 'ALL')));
    if (uniqueKeys.length === 0) return true;
    const count = await this.permissionModel.countDocuments({ key: { $in: uniqueKeys } }).exec();
    return count === uniqueKeys.length;
  }

  async getInvalidPermissionKeys(permissionKeys: string[]): Promise<string[]> {
    const uniqueKeys = Array.from(new Set(permissionKeys.filter((k) => k !== 'ALL')));
    if (uniqueKeys.length === 0) return [];
    const validPerms = await this.permissionModel.find({ key: { $in: uniqueKeys } }).exec();
    const foundKeys = new Set(validPerms.map((p) => p.key));
    return uniqueKeys.filter((k) => !foundKeys.has(k));
  }

  private toData(doc: MenuItemDocument): IMenuItemData {
    return {
      id: doc.id,
      key: doc.key,
      application: doc.application,
      label: doc.label,
      type: doc.type,
      icon: doc.icon,
      route: doc.route,
      parentId: doc.parentId,
      order: doc.order,
      visibility: doc.visibility,
      status: doc.status,
    };
  }
}
