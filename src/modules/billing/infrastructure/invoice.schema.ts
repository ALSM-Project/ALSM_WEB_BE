import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { InvoiceStatus, PlanTier } from '../domain/billing.types';

export type InvoiceDocument = HydratedDocument<Invoice>;

@Schema({ collection: 'invoices', timestamps: true })
export class Invoice {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Subscription', index: true })
  subscriptionId!: Types.ObjectId;

  /** Human-readable invoice number: INV-YYYY-NNNN */
  @Prop({ required: true, unique: true })
  invoiceNumber!: string;

  @Prop({ enum: PlanTier, required: true })
  planTier!: PlanTier;

  @Prop({ required: true })
  planName!: string;

  /** Amount in VND */
  @Prop({ required: true })
  amountVnd!: number;

  @Prop({ enum: InvoiceStatus, default: InvoiceStatus.PENDING })
  status!: InvoiceStatus;

  @Prop({ required: true })
  billingPeriodStart!: Date;

  @Prop({ required: true })
  billingPeriodEnd!: Date;

  @Prop()
  paidAt?: Date;

  @Prop()
  paymentMethod?: string;

  createdAt!: Date;
  updatedAt!: Date;
}

export const InvoiceSchema = SchemaFactory.createForClass(Invoice);
InvoiceSchema.index({ userId: 1, createdAt: -1 });
