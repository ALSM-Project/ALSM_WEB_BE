import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PermissionDocument = Permission & Document;

@Schema({ collection: 'permissions', timestamps: true })
export class Permission {
  @Prop({ required: true, unique: true, trim: true })
  key!: string;

  @Prop({ required: true, trim: true })
  label!: string;

  @Prop({ required: true, trim: true })
  group!: string;

  @Prop({ default: '' })
  description!: string;
}

export const PermissionSchema = SchemaFactory.createForClass(Permission);
