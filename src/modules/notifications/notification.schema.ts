import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongoSchema, Types } from 'mongoose';

export type NotificationDocument = HydratedDocument<SystemNotification>;

@Schema({ collection: 'notifications', timestamps: true })
export class SystemNotification {
  @Prop({ type: MongoSchema.Types.ObjectId, required: true, index: true }) userId!: Types.ObjectId;
  @Prop({ required: true, trim: true, maxlength: 80 }) type!: string;
  @Prop({ required: true, trim: true, maxlength: 160 }) title!: string;
  @Prop({ required: true, trim: true, maxlength: 500 }) message!: string;
  @Prop({ trim: true, maxlength: 80 }) resourceType?: string;
  @Prop({ trim: true, maxlength: 120 }) resourceId?: string;
  @Prop({ trim: true, maxlength: 500 }) link?: string;
  @Prop({ required: true, default: false, index: true }) isRead!: boolean;
  @Prop({ required: true, trim: true, maxlength: 200, unique: true }) eventKey!: string;
  createdAt!: Date;
  updatedAt!: Date;
}

export const SystemNotificationSchema = SchemaFactory.createForClass(SystemNotification);
SystemNotificationSchema.index({ userId: 1, createdAt: -1 });
SystemNotificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });
