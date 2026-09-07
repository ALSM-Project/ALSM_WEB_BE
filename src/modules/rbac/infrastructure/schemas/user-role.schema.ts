import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserRoleDocument = UserRole & Document;

@Schema({ collection: 'user_roles', timestamps: true })
export class UserRole {
  @Prop({ required: true, trim: true, index: true })
  userId!: string;

  @Prop({ required: true, trim: true, index: true })
  roleId!: string;
}

export const UserRoleSchema = SchemaFactory.createForClass(UserRole);
UserRoleSchema.index({ userId: 1, roleId: 1 }, { unique: true });
