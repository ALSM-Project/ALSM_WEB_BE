import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { PlanTier, QuoteRequestStatus } from '../domain/billing.types';

export type QuoteRequestDocument = HydratedDocument<QuoteRequest>;

@Schema({ collection: 'quote_requests', timestamps: true })
export class QuoteRequest {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId })
  activeRequestUserId?: Types.ObjectId;

  @Prop({ required: true })
  fullName!: string;

  @Prop({ required: true })
  companyName!: string;

  @Prop({ required: true })
  email!: string;

  @Prop()
  phone?: string;

  @Prop()
  message?: string;

  @Prop({ enum: PlanTier, default: PlanTier.STARTER })
  currentPlanTier!: PlanTier;

  @Prop({ enum: QuoteRequestStatus, default: QuoteRequestStatus.PENDING, index: true })
  status!: QuoteRequestStatus;

  @Prop({ maxlength: 1000 })
  statusReason?: string;

  @Prop({ maxlength: 2000 })
  appealMessage?: string;

  @Prop({ enum: ['PENDING', 'APPROVED', 'DECLINED'] })
  appealStatus?: 'PENDING' | 'APPROVED' | 'DECLINED';

  @Prop({ maxlength: 1000 })
  appealResponse?: string;

  appealedAt?: Date;
  appealResolvedAt?: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export const QuoteRequestSchema = SchemaFactory.createForClass(QuoteRequest);
QuoteRequestSchema.index({ userId: 1, status: 1 });
QuoteRequestSchema.index({ activeRequestUserId: 1 }, { unique: true, sparse: true });
