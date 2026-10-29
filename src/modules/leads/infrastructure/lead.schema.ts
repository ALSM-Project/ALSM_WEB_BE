import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { LeadStatus, LeadSource, LeadPriority, LeadEmailNotificationStatus, LeadPhoneCall, LeadDemo } from '../domain/lead.types';

export type LeadDocument = Lead & Document;
export const UC58_LEAD_MODEL = 'Uc58Lead';

@Schema({ collection: 'leads', timestamps: true })
export class Lead {
  @Prop({ required: true, trim: true })
  companyName!: string;

  @Prop({ required: true, trim: true })
  contactName!: string;

  @Prop({ required: true, trim: true, lowercase: true })
  contactEmail!: string;

  @Prop({ trim: true })
  contactPhone?: string;

  @Prop({ trim: true })
  jobTitle?: string;

  @Prop({ type: String, enum: LeadStatus, default: LeadStatus.NEW })
  status!: LeadStatus;

  @Prop({ type: String, enum: LeadSource, required: true })
  source!: LeadSource;

  @Prop({ type: String, enum: LeadPriority, default: LeadPriority.MEDIUM })
  priority!: LeadPriority;

  @Prop({ type: Number })
  estimatedValue?: number;

  @Prop({ type: String, default: 'USD' })
  currency!: string;

  @Prop({ trim: true })
  notes?: string;

  @Prop({ type: Types.ObjectId })
  assignedToUserId?: Types.ObjectId;

  @Prop({ trim: true, lowercase: true })
  assignedToEmail?: string;

  @Prop({ type: [String], default: [] })
  tags!: string[];

  @Prop({ type: Date })
  lastContactedAt?: Date;

  @Prop({ type: Date })
  nextFollowUpAt?: Date;

  @Prop({ type: Types.ObjectId, required: true })
  createdByUserId!: Types.ObjectId;

  @Prop({ required: true, trim: true, lowercase: true })
  createdByEmail!: string;

  @Prop({ select: false })
  creationFingerprint?: string;

  @Prop({ select: false })
  dedupeKey?: string;

  @Prop({ type: String, enum: ['PENDING', 'SENDING', 'SENT', 'FAILED'], default: 'PENDING' })
  emailNotificationStatus?: LeadEmailNotificationStatus;

  @Prop({ type: Date })
  emailNotifiedAt?: Date;

  @Prop({ select: false })
  emailNotificationRequestId?: string;

  @Prop({ type: [Object], default: [] })
  quotes!: Array<{
    id: string;
    requestId: string;
    requestFingerprint: string;
    quoteNumber: string;
    planName: string;
    projectScope?: string;
    amount: number;
    discountPercent?: number;
    discountApproved?: boolean;
    discountReason?: string;
    status: 'DRAFT' | 'PENDING_APPROVAL' | 'SENT' | 'ACCEPTED' | 'REJECTED';
    recipientEmail?: string;
    expiresAt?: Date;
    sentAt?: Date;
    pdfUrl?: string;
    createdAt: Date;
  }>;

  @Prop({ type: [Object], default: [] })
  phoneCalls!: LeadPhoneCall[];

  @Prop({ type: [Object], default: [] })
  demos!: LeadDemo[];

  createdAt!: Date;
  updatedAt!: Date;
}

export const LeadSchema = SchemaFactory.createForClass(Lead);

// Indexes for common queries
LeadSchema.index({ status: 1 });
LeadSchema.index({ source: 1 });
LeadSchema.index({ priority: 1 });
LeadSchema.index({ assignedToUserId: 1 });
LeadSchema.index({ companyName: 'text', contactName: 'text', contactEmail: 'text' });
LeadSchema.index({ createdAt: -1 });
LeadSchema.index(
  { dedupeKey: 1 },
  {
    unique: true,
    name: 'one_lead_per_normalized_email',
    partialFilterExpression: { dedupeKey: { $type: 'string' } },
  },
);
