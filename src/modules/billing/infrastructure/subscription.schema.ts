import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  BillingCycle,
  PlanTier,
  SubscriptionStatus,
} from '../domain/billing.types';

export type SubscriptionDocument = HydratedDocument<Subscription>;

@Schema({ collection: 'subscriptions', timestamps: true })
export class Subscription {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  organizationId!: Types.ObjectId;

  @Prop({ enum: PlanTier, required: true })
  planTier!: PlanTier;

  @Prop({ required: true })
  planName!: string;

  @Prop({ enum: BillingCycle, required: true })
  billingCycle!: BillingCycle;

  @Prop({ enum: SubscriptionStatus, default: SubscriptionStatus.PENDING_PAYMENT })
  status!: SubscriptionStatus;

  /** Amount in VND */
  @Prop({ required: true })
  amountVnd!: number;

  @Prop()
  trialEndsAt?: Date;

  @Prop()
  currentPeriodStart?: Date;

  @Prop()
  currentPeriodEnd?: Date;

  @Prop()
  cancelledAt?: Date;

  @Prop()
  cancelReason?: string;

  @Prop()
  cancelFeedback?: string;

  createdAt!: Date;
  updatedAt!: Date;
}

export const SubscriptionSchema = SchemaFactory.createForClass(Subscription);
SubscriptionSchema.index({ userId: 1, status: 1 });
SubscriptionSchema.index({ organizationId: 1, status: 1 });
