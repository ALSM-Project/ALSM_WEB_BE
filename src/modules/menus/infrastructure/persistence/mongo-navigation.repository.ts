import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MenuItem, MenuItemDocument } from '../schemas/menu-item.schema';
import { MenuItemPermission, MenuItemPermissionDocument } from '../schemas/menu-item-permission.schema';
import { INavigationRepository, IMenuItemData } from '../../domain/interfaces/menu-builder.repository.interface';
import { ApplicationContext, MenuItemStatus } from '../../domain/enums/menu.enums';

@Injectable()
export class MongoNavigationRepository implements INavigationRepository {
  constructor(
    @InjectModel(MenuItem.name) private readonly menuItemModel: Model<MenuItemDocument>,
    @InjectModel(MenuItemPermission.name) private readonly menuItemPermissionModel: Model<MenuItemPermissionDocument>,
  ) {}

  async findActiveVisibleMenuItems(app: ApplicationContext): Promise<IMenuItemData[]> {
    const docs = await this.menuItemModel
      .find({ application: app, visibility: true, status: MenuItemStatus.ACTIVE })
      .sort({ order: 1 })
      .exec();

    return docs.map((doc) => ({
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
    }));
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
}
