import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type RolePermissionDocument = RolePermission & Document;

@Schema({ collection: 'role_permissions', timestamps: true })
export class RolePermission {
  @Prop({ required: true, trim: true, index: true })
  roleId!: string;

  @Prop({ required: true, trim: true, index: true })
  permissionKey!: string;
}

export const RolePermissionSchema = SchemaFactory.createForClass(RolePermission);
RolePermissionSchema.index({ roleId: 1, permissionKey: 1 }, { unique: true });
