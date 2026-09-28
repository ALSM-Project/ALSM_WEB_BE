import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { ConversionQualityReviewStatus } from '../domain/conversion-quality-review.types';

export type ConversionQualityReviewDocument = HydratedDocument<ConversionQualityReview>;

@Schema({ collection: 'conversion_quality_reviews', timestamps: true })
export class ConversionQualityReview {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  organizationId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  projectId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  conversionJobId!: Types.ObjectId;

  @Prop({ index: true })
  screenId?: string;

  @Prop({ enum: ConversionQualityReviewStatus, required: true, default: ConversionQualityReviewStatus.PENDING })
  status!: ConversionQualityReviewStatus;

  @Prop({ type: String })
  reviewNote?: string;

  @Prop({ type: Number })
  qualityScore?: number;

  @Prop({ type: MongooseSchema.Types.ObjectId })
  reviewedBy?: Types.ObjectId;

  @Prop({ type: Date })
  reviewedAt?: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export const ConversionQualityReviewSchema = SchemaFactory.createForClass(ConversionQualityReview);

// One review per conversion job per tenant — unique sparse compound index
ConversionQualityReviewSchema.index(
  { organizationId: 1, projectId: 1, conversionJobId: 1 },
  { unique: true },
);
