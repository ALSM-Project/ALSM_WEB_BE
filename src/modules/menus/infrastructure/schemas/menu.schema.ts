import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { IMenuItem } from '../../domain/value-objects/menu-item.vo';

export type MenuDocument = Menu & Document;

@Schema({ collection: 'menus', timestamps: true })
export class Menu {
  @Prop({ required: true, unique: true })
  role!: string;

  @Prop({ default: false })
  isDefault!: boolean;

  @Prop({ type: Array, default: [] })
  items!: IMenuItem[];

  @Prop({ type: String })
  createdBy?: string;

  @Prop({ type: String })
  updatedBy?: string;
}

export const MenuSchema = SchemaFactory.createForClass(Menu);
