import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
export type UserDocument = HydratedDocument<User>;
@Schema({ collection: 'users', timestamps: true })
export class User {
  @Prop({ required: true, unique: true, lowercase: true, trim: true }) email!: string;
  @Prop({ required: true, select: false }) passwordHash!: string;
  @Prop({ required: true, trim: true }) fullName!: string;
  @Prop({ default: false }) isPlatformAdmin!: boolean;
  @Prop({ default: true }) isActive!: boolean;
  createdAt!: Date;
  updatedAt!: Date;
}
export const UserSchema = SchemaFactory.createForClass(User);
