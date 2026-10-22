import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongoSchema, Types } from 'mongoose';
import {
  DeliverableCustomerReview,
  DeliverableTeamLeadReview,
  DeliverablePackageType,
  DeliverableRecord,
  DeliverableStatus,
} from '../domain/deliverable.types';

@Schema({ _id: false })
class DeliverableCustomerReviewSchemaClass implements DeliverableCustomerReview {
  @Prop({ required: true, enum: ['APPROVED', 'REVISION_REQUESTED'] })
  decision!: 'APPROVED' | 'REVISION_REQUESTED';

  @Prop({ required: true })
  reviewedByUserId!: string;

  @Prop({ required: true })
  reviewedByUserName!: string;

  @Prop({ required: true })
  reviewedAt!: Date;

  @Prop()
  feedbackNotes?: string;
}
const DeliverableCustomerReviewSchema = SchemaFactory.createForClass(
  DeliverableCustomerReviewSchemaClass,
);

@Schema({ _id: false })
class DeliverableTeamLeadReviewSchemaClass implements DeliverableTeamLeadReview {
  @Prop({ required: true, enum: ['APPROVED', 'REVISION_REQUESTED'] })
  decision!: 'APPROVED' | 'REVISION_REQUESTED';

  @Prop({ required: true })
  reviewedByUserId!: string;

  @Prop({ required: true })
  reviewedByUserName!: string;

  @Prop({ required: true })
  reviewedAt!: Date;

  @Prop()
  feedbackNotes?: string;
}
const DeliverableTeamLeadReviewSchema = SchemaFactory.createForClass(
  DeliverableTeamLeadReviewSchemaClass,
);

@Schema({ collection: 'deliverables', timestamps: true })
export class DeliverableDocument extends Document {
  @Prop({ type: MongoSchema.Types.ObjectId, required: true, index: true })
  projectId!: Types.ObjectId;

  @Prop({ required: true })
  projectName!: string;

  @Prop({ type: MongoSchema.Types.ObjectId, required: true, index: true })
  organizationId!: Types.ObjectId;

  @Prop({ required: true })
  version!: string;

  @Prop({ required: true })
  title!: string;

  @Prop({ required: true })
  description!: string;

  @Prop({
    required: true,
    enum: [
      'FULL_MODERNIZATION_PACKAGE',
      'FRONTEND_COMPONENTS',
      'BACKEND_SERVICES',
      'VALIDATION_REPORT',
      'TECHNICAL_REPORT',
      'REVIEW_REPORT',
    ],
  })
  packageType!: DeliverablePackageType;

  @Prop({ required: true, default: 0 })
  fileCount!: number;

  @Prop({ required: true, default: '0 MB' })
  totalSizeFormatted!: string;

  @Prop()
  downloadUrl?: string;

  @Prop({
    required: true,
    enum: [
      'DRAFT',
      'IN_REVIEW',
      'APPROVED',
      'PUBLISHED',
      'READY_FOR_REVIEW',
      'REVISION_REQUESTED',
    ],
    default: 'READY_FOR_REVIEW',
    index: true,
  })
  status!: DeliverableStatus;

  @Prop()
  uploadedByUserId?: string;

  @Prop()
  uploadedByName?: string;

  @Prop()
  uploadedByRole?: string;

  @Prop({ type: DeliverableTeamLeadReviewSchema })
  teamLeadReview?: DeliverableTeamLeadReview;

  @Prop()
  publishedAt?: Date;

  @Prop()
  publishedBy?: string;

  @Prop()
  publishedByName?: string;

  @Prop({ type: DeliverableCustomerReviewSchema })
  customerReview?: DeliverableCustomerReview;

  createdAt!: Date;
  updatedAt!: Date;
}

export const DeliverableSchema = SchemaFactory.createForClass(DeliverableDocument);
DeliverableSchema.index({ organizationId: 1, createdAt: -1 });
DeliverableSchema.index({ projectId: 1, version: 1 });
