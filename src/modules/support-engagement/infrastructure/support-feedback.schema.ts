import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongoSchema, Types } from 'mongoose';

export type SupportFeedbackDocument = HydratedDocument<SupportFeedback>;

export const FEEDBACK_CATEGORIES = [
  'Overall Experience',
  'Conversion Quality',
  'System Performance',
  'User Interface',
  'Customer Support',
  'Feature Request',
] as const;

export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export enum FeedbackStatus {
  SUBMITTED = 'SUBMITTED',
  IN_REVIEW = 'IN_REVIEW',
  ACKNOWLEDGED = 'ACKNOWLEDGED',
  RESOLVED = 'RESOLVED',
}

@Schema({ collection: 'support_feedbacks', timestamps: true })
export class SupportFeedback {
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ required: true, trim: true, lowercase: true, index: true })
  userEmail!: string;

  @Prop({ required: true, trim: true })
  userName!: string;

  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'Organization', index: true })
  organizationId?: Types.ObjectId;

  @Prop({ required: true, min: 1, max: 5, index: true })
  rating!: number;

  @Prop({ required: true, enum: FEEDBACK_CATEGORIES, index: true })
  category!: FeedbackCategory;

  @Prop({ required: true, trim: true })
  description!: string;

  @Prop({ type: [Object], default: [] })
  attachments?: Array<{
    fileId?: string;
    name: string;
    url?: string;
    size?: number;
    mimeType?: string;
  }>;

  @Prop({ enum: FeedbackStatus, default: FeedbackStatus.SUBMITTED, index: true })
  status!: FeedbackStatus;

  @Prop({ trim: true })
  staffNotes?: string;

  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'User' })
  reviewedByUserId?: Types.ObjectId;

  @Prop({ trim: true })
  reviewedByName?: string;

  @Prop()
  reviewedAt?: Date;
}

export const SupportFeedbackSchema = SchemaFactory.createForClass(SupportFeedback);
