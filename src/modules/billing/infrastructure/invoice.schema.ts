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
  subscriptionId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'ContractAggregate', index: true })
  contractId?: Types.ObjectId;

  @Prop({ index: true })
  contractNumber?: string;

  /** Human-readable invoice number: INV-YYYY-NNNN */
  @Prop({ required: true, unique: true })
  invoiceNumber!: string;

  @Prop({ enum: PlanTier, required: true })
  planTier!: PlanTier;

  @Prop({ required: true })
  planName!: string;

  @Prop({ default: 0 })
  subtotalVnd?: number;

  @Prop({ default: 10 })
  vatRate?: number;

  @Prop({ default: 0 })
  taxAmountVnd?: number;

  /** Amount in VND */
  @Prop({ required: true })
  amountVnd!: number;

  @Prop({ default: 'VND' })
  currency?: string;

  @Prop({ enum: InvoiceStatus, default: InvoiceStatus.PENDING })
  status!: InvoiceStatus;

  @Prop({ required: true })
  billingPeriodStart!: Date;

  @Prop({ required: true })
  billingPeriodEnd!: Date;

  @Prop()
  dueDate?: Date;

  @Prop()
  paidAt?: Date;

  @Prop()
  paymentMethod?: string;

  @Prop()
  cassoTransactionId?: string;

  @Prop({ type: Array, default: [] })
  items?: any[];

  createdAt!: Date;
  updatedAt!: Date;
}

export const InvoiceSchema = SchemaFactory.createForClass(Invoice);
InvoiceSchema.index({ userId: 1, createdAt: -1 });
InvoiceSchema.index({ contractNumber: 1 });
InvoiceSchema.index({ organizationId: 1, createdAt: -1 });
