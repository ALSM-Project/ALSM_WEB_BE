import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { ApplicationContext, MenuItemStatus, MenuItemType } from '../../domain/enums/menu.enums';

export type MenuItemDocument = MenuItem & Document;
export { ApplicationContext, MenuItemStatus, MenuItemType };

@Schema({ collection: 'menu_items', timestamps: true })
export class MenuItem {
  @Prop({ required: true, unique: true, trim: true })
  id!: string;

  @Prop({ required: true, trim: true })
  key!: string;

  @Prop({ required: true, enum: ApplicationContext, index: true })
  application!: ApplicationContext;

  @Prop({ required: true, trim: true })
  label!: string;

  @Prop({ required: true, enum: MenuItemType, default: MenuItemType.PAGE })
  type!: MenuItemType;

  @Prop({ default: 'Folder' })
  icon!: string;

  @Prop({ type: String, default: null })
  route!: string | null;

  @Prop({ type: String, default: null, index: true })
  parentId!: string | null;

  @Prop({ default: 0 })
  order!: number;

  @Prop({ default: true })
  visibility!: boolean;

  @Prop({ required: true, enum: MenuItemStatus, default: MenuItemStatus.ACTIVE })
  status!: MenuItemStatus;
}

export const MenuItemSchema = SchemaFactory.createForClass(MenuItem);
MenuItemSchema.index({ application: 1, parentId: 1, order: 1 });
