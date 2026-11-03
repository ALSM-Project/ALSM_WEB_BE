import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongoSchema, Types } from 'mongoose';
import { ContractEmailOutboxStatus, ContractEmailDeliveryResult } from '../domain/contract-notification-email-outbox.types';

@Schema({ collection: 'contract_notification_email_outbox', timestamps: true })
export class ContractNotificationEmailOutbox {
  @Prop({ required: true, unique: true, trim: true, maxlength: 220 }) eventKey!: string;
  @Prop({ type: MongoSchema.Types.ObjectId, required: true, index: true }) contractId!: Types.ObjectId;
  @Prop({ type: MongoSchema.Types.ObjectId, required: true, index: true }) organizationId!: Types.ObjectId;
  @Prop({ type: MongoSchema.Types.ObjectId, required: true }) actorUserId!: Types.ObjectId;
  @Prop({ type: MongoSchema.Types.ObjectId, required: true, index: true }) recipientUserId!: Types.ObjectId;
  @Prop({ required: true, lowercase: true, trim: true, maxlength: 320 }) recipientEmail!: string;
  @Prop({ required: true, trim: true, maxlength: 180 }) subject!: string;
  @Prop({ required: true, maxlength: 5000 }) text!: string;
  @Prop({ required: true, maxlength: 12000 }) html!: string;
  @Prop({ required: true, enum: ['PENDING', 'PROCESSING', 'RETRY', 'BLOCKED_CONFIGURATION', 'SENT', 'DEAD'], default: 'PENDING', index: true }) status!: ContractEmailOutboxStatus;
  @Prop({ required: true, default: 0, min: 0 }) attempts!: number;
  @Prop({ required: true, default: 10, min: 1, max: 10 }) maxAttempts!: number;
  @Prop({ required: true, default: Date.now, index: true }) nextAttemptAt!: Date;
  @Prop() lastAttemptAt?: Date;
  @Prop({ maxlength: 80 }) leaseToken?: string;
  @Prop() leaseExpiresAt?: Date;
  @Prop({ enum: ['SENT', 'NOT_CONFIGURED', 'UNCONFIRMED', 'FAILED'] }) lastDeliveryResult?: ContractEmailDeliveryResult;
  @Prop() sentAt?: Date;
  createdAt!: Date;
  updatedAt!: Date;
}

export type ContractNotificationEmailOutboxDocument = HydratedDocument<ContractNotificationEmailOutbox>;
export const ContractNotificationEmailOutboxSchema = SchemaFactory.createForClass(ContractNotificationEmailOutbox);
ContractNotificationEmailOutboxSchema.index(
  { status: 1, nextAttemptAt: 1, createdAt: 1 },
  { name: 'contract_email_outbox_ready' },
);
ContractNotificationEmailOutboxSchema.index(
  { status: 1, leaseExpiresAt: 1 },
  { name: 'contract_email_outbox_expired_lease' },
);
