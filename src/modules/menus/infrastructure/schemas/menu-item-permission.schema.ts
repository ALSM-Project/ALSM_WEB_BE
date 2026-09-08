import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type MenuItemPermissionDocument = MenuItemPermission & Document;

@Schema({ collection: 'menu_item_permissions', timestamps: true })
export class MenuItemPermission {
  @Prop({ required: true, trim: true, index: true })
  menuItemId!: string;

  @Prop({ required: true, trim: true, index: true })
  permissionKey!: string;
}

export const MenuItemPermissionSchema = SchemaFactory.createForClass(MenuItemPermission);
MenuItemPermissionSchema.index({ menuItemId: 1, permissionKey: 1 }, { unique: true });
