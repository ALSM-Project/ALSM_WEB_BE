import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongoSchema, Types } from 'mongoose';
import { LeadAssignment, LeadConversion, LeadStatus } from '../domain/lead.types';
export type LeadDocument = HydratedDocument<Lead>;

@Schema({ collection: 'leads', timestamps: true })
export class Lead {
  @Prop({ enum: LeadStatus, required: true }) status!: LeadStatus;
  @Prop({ type: MongoSchema.Types.ObjectId, required: true }) organizationId!: Types.ObjectId;
  @Prop({ required: true, maxlength: 120 }) title!: string;
  @Prop({ required: true, maxlength: 200 }) sourceReference!: string;
  @Prop() contactEmail?: string;
  @Prop({ required: true }) creationFingerprint!: string;
  @Prop({ required: true }) revision!: number;
  @Prop({ type: [Object], required: true }) assignments!: LeadAssignment[];
  @Prop({ type: Object }) conversion?: LeadConversion;

  // Rich CRM attributes (Report 3 Section 3.11)
  @Prop({ trim: true }) contactName?: string;
  @Prop({ trim: true }) company?: string;
  // Compatibility fields retained for lead records created by the earlier CRM schema.
  @Prop({ trim: true }) companyName?: string;
  @Prop({ trim: true }) phone?: string;
  @Prop({ trim: true, default: 'Website' }) source?: string;
  @Prop({ default: 'NEW', index: true }) stage!: 'NEW' | 'CONTACTED' | 'QUALIFIED' | 'PROPOSAL' | 'WON' | 'LOST';
  @Prop({ default: 50 }) score!: number;
  @Prop({ type: Number, min: 0 }) dealValue?: number;
  @Prop({ type: Number, min: 0 }) estimatedValue?: number;
  @Prop({ type: String, trim: true, uppercase: true, default: 'VND' }) currency?: string;
  @Prop({ type: MongoSchema.Types.ObjectId }) assignedToUserId?: Types.ObjectId;
  @Prop({ trim: true }) assignedToName?: string;
  @Prop() lastContactAt?: Date;
  @Prop() notes?: string;
  @Prop({ type: [Object], default: [] }) interactions!: Array<{
    id: string;
    type: 'CALL' | 'EMAIL' | 'MEETING';
    summary: string;
    durationMinutes?: number;
    outcome?: string;
    actionItems?: string;
    notes?: string;
    performedBy: string;
    createdAt: Date;
  }>;
  @Prop({ type: [Object], default: [] }) demos!: Array<{
    id: string;
    title: string;
    scheduledAt: Date;
    description?: string;
    meetLink: string;
    status: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED';
    scheduledBy: string;
    createdAt: Date;
  }>;
  @Prop({ type: [Object], default: [] }) quotes!: Array<{
    id: string;
    planName: string;
    projectScope?: string;
    amount: number;
    discountPercent?: number;
    discountApproved?: boolean;
    discountReason?: string;
    status: 'DRAFT' | 'PENDING_APPROVAL' | 'SENT' | 'ACCEPTED' | 'REJECTED';
    sentAt?: Date;
    pdfUrl?: string;
    createdAt: Date;
  }>;
  @Prop({ type: [Object], default: [] }) contracts!: Array<{
    id: string;
    requestId?: string;
    requestFingerprint?: string;
    quoteId?: string;
    contractNumber?: string;
    title?: string;
    documentTitle?: string;
    plan?: string;
    annualValue?: number;
    status: 'DRAFT' | 'SENT_FOR_SIGNATURE' | 'SIGNED' | 'DECLINED';
    effectiveDate?: string;
    envelopeId?: string;
    signedAt?: Date;
    createdByUserId?: string;
    createdAt: Date;
  }>;
  @Prop({ trim: true }) assignedTo?: string;
  createdAt!: Date;
  updatedAt!: Date;
}
export const LeadSchema = SchemaFactory.createForClass(Lead);
LeadSchema.index({ organizationId: 1, 'assignments.teamId': 1, 'assignments.startedAt': 1 });
LeadSchema.index(
  { organizationId: 1, sourceReference: 1 },
  { unique: true, name: 'one_lead_per_source_reference' },
);
LeadSchema.index({ organizationId: 1, stage: 1, score: -1 });
LeadSchema.index({ contactEmail: 1 });
