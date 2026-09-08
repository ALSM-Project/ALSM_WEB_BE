import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { PaymentStatus, PlanTier } from '../domain/billing.types';

export type PaymentDocument = HydratedDocument<Payment>;

@Schema({ collection: 'payments', timestamps: true })
export class Payment {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Invoice' })
  invoiceId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Subscription' })
  subscriptionId?: Types.ObjectId;

  @Prop({ enum: PlanTier, required: true })
  planTier!: PlanTier;

  /** Amount in VND */
  @Prop({ required: true })
  amountVnd!: number;

  @Prop({ enum: PaymentStatus, default: PaymentStatus.PENDING })
  status!: PaymentStatus;

  /** Unique reference code for bank transfer matching: e.g. "ALSM0142" */
  @Prop({ required: true, unique: true, index: true })
  referenceCode!: string;

  /** VietQR URL for QR code image */
  @Prop()
  qrDataUrl?: string;

  /** Bank info for manual transfer */
  @Prop({ required: true })
  bankName!: string;

  @Prop({ required: true })
  accountNumber!: string;

  @Prop({ required: true })
  accountName!: string;

  /** QR code expiry time */
  @Prop({ required: true })
  expiresAt!: Date;

  /** Casso transaction ID once matched */
  @Prop()
  cassoTransactionId?: string;

  @Prop()
  paidAt?: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export const PaymentSchema = SchemaFactory.createForClass(Payment);
PaymentSchema.index({ referenceCode: 1 });
PaymentSchema.index({ status: 1, expiresAt: 1 });
