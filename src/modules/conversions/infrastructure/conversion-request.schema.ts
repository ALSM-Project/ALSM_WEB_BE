import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { ConversionRequestStatus, ManagedConversionPipeline } from '../domain/conversion-request.types';

export type ConversionRequestDocument = HydratedDocument<ConversionRequest>;

@Schema({ collection: 'conversion_requests', timestamps: true })
export class ConversionRequest {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  organizationId!: Types.ObjectId;

  @Prop({ required: true, unique: true, index: true, trim: true })
  requestNumber!: string;

  @Prop({ required: true, trim: true })
  projectName!: string;

  @Prop({ trim: true })
  projectDescription?: string;

  @Prop({ trim: true })
  businessDomain?: string;

  @Prop({ trim: true, index: true })
  contractNumber?: string;

  @Prop({ trim: true })
  contractId?: string;

  @Prop({ enum: ManagedConversionPipeline, default: ManagedConversionPipeline.BMS_DSPF_TO_FRONTEND })
  pipeline!: ManagedConversionPipeline;

  @Prop({ default: 'IBM Mainframe BMS / DSPF Screen Definitions', trim: true })
  sourceTechnology!: string;

  @Prop({ default: 'React 19, TypeScript & Tailwind CSS', trim: true })
  targetArchitecture!: string;

  @Prop({
    type: {
      estimatedScreens: { type: Number, default: 0 },
      estimatedPrograms: { type: Number, default: 0 },
      estimatedLinesOfCode: { type: Number, default: 0 },
      complexity: { type: String, default: 'MEDIUM' },
    },
    default: {},
  })
  scope!: {
    estimatedScreens?: number;
    estimatedPrograms?: number;
    estimatedLinesOfCode?: number;
    complexity?: string;
  };

  @Prop({
    type: {
      name: { type: String, required: true },
      email: { type: String, required: true },
      phone: { type: String },
      role: { type: String },
    },
    required: true,
  })
  contact!: {
    name: string;
    email: string;
    phone?: string;
    role?: string;
  };

  @Prop({ trim: true })
  specialInstructions?: string;

  @Prop({ trim: true })
  businessRequirements?: string;

  @Prop({ trim: true })
  expectedDeliverables?: string;

  @Prop({ type: Number })
  preferredTimelineWeeks?: number;

  @Prop({
    type: [
      {
        fileId: { type: String, required: true },
        originalName: { type: String, required: true },
        fileSize: { type: Number, required: true },
        mimeType: { type: String, default: 'application/octet-stream' },
        category: { type: String, default: 'SOURCE_CODE' },
        uploadedAt: { type: Date, default: Date.now },
        storageKey: { type: String },
      },
    ],
    default: [],
  })
  files!: Array<{
    fileId: string;
    originalName: string;
    fileSize: number;
    mimeType: string;
    category: string;
    uploadedAt: Date;
    storageKey?: string;
  }>;

  @Prop({
    enum: ConversionRequestStatus,
    default: ConversionRequestStatus.SUBMITTED,
    index: true,
  })
  status!: ConversionRequestStatus;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Project', required: false, index: true })
  linkedProjectId?: Types.ObjectId;

  @Prop({ trim: true })
  reviewFeedback?: string;

  @Prop()
  submittedAt?: Date;

  @Prop()
  reviewedAt?: Date;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  reviewedBy?: Types.ObjectId;

  @Prop()
  projectCreatedAt?: Date;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  createdBy!: Types.ObjectId;

  createdAt!: Date;
  updatedAt!: Date;
}

export const ConversionRequestSchema = SchemaFactory.createForClass(ConversionRequest);
ConversionRequestSchema.index({ organizationId: 1, createdAt: -1 });
ConversionRequestSchema.index({ organizationId: 1, status: 1 });
