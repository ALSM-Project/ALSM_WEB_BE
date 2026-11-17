import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { ConversionType, ManagedProjectStage, ProjectStatus } from '../domain/project.types';

export type ProjectDocument = HydratedDocument<Project>;

@Schema({ collection: 'projects', timestamps: true })
export class Project {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  organizationId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ trim: true })
  description?: string;

  @Prop({ enum: ConversionType, required: true })
  conversionType!: ConversionType;

  @Prop({ enum: ProjectStatus, default: ProjectStatus.DRAFT, index: true })
  status!: ProjectStatus;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  createdBy!: Types.ObjectId;

  @Prop({ enum: ['SELF_SERVICE', 'MANAGED'], default: 'SELF_SERVICE', index: true })
  serviceType?: 'SELF_SERVICE' | 'MANAGED';

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'ConversionRequest', required: false, index: true })
  conversionRequestId?: Types.ObjectId;

  @Prop({ trim: true, index: true })
  contractNumber?: string;

  @Prop({ trim: true })
  contractId?: string;

  @Prop({
    enum: ManagedProjectStage,
    default: ManagedProjectStage.REQUIREMENTS_GATHERING,
    index: true,
  })
  currentStage?: ManagedProjectStage;

  @Prop({ type: Number, default: 1 })
  stageIndex?: number;

  @Prop({ type: Number, default: 11 })
  progressPct?: number;

  @Prop()
  submittedAt?: Date;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  submittedBy?: Types.ObjectId;

  @Prop({ trim: true })
  businessRequirements?: string;

  @Prop({ trim: true })
  adminReviewNotes?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  reviewedBy?: Types.ObjectId;

  @Prop()
  reviewedAt?: Date;

  @Prop({ default: false })
  isDemo?: boolean;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: false, index: true })
  assignedTeamLeadId?: Types.ObjectId;

  @Prop({ trim: true })
  assignedTeamLeadName?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: false })
  teamLeadAssignedBy?: Types.ObjectId;

  @Prop({ trim: true })
  teamLeadAssignedByName?: string;

  @Prop()
  teamLeadAssignedAt?: Date;

  @Prop({ trim: true })
  teamLeadAssignmentNote?: string;

  @Prop({ trim: true, default: 'ASSIGNED' })
  teamLeadAssignmentStatus?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: false, index: true })
  assignedStaffId?: Types.ObjectId;

  @Prop({ trim: true })
  assignedStaffName?: string;

  @Prop({ trim: true })
  staffAssignmentNote?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: false })
  staffAssignedBy?: Types.ObjectId;

  @Prop()
  staffAssignedAt?: Date;

  @Prop({
    type: [
      {
        fileId: { type: String, required: true },
        originalName: { type: String, required: true },
        fileSize: { type: Number, required: true },
        mimeType: { type: String, default: 'application/octet-stream' },
        category: { type: String, default: 'SOURCE_CODE' },
        storageKey: { type: String },
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
    default: [],
  })
  files?: Array<{
    fileId: string;
    originalName: string;
    fileSize: number;
    mimeType?: string;
    category?: string;
    storageKey?: string;
    uploadedAt?: Date;
  }>;

  @Prop({
    type: {
      accepted: { type: Boolean, default: false },
      acceptedBy: { type: String },
      acceptedByName: { type: String },
      acceptedAt: { type: Date },
      notes: { type: String },
    },
    default: undefined,
  })
  acceptance?: {
    accepted: boolean;
    acceptedBy?: string;
    acceptedByName?: string;
    acceptedAt?: Date;
    notes?: string;
  };

  @Prop({ default: false })
  isExported?: boolean;

  @Prop()
  exportedAt?: Date;

  @Prop({ trim: true })
  exportedBundleName?: string;

  @Prop()
  deletedAt?: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export const ProjectSchema = SchemaFactory.createForClass(Project);
ProjectSchema.index({ organizationId: 1, deletedAt: 1, createdAt: -1 });
ProjectSchema.index({ status: 1, serviceType: 1 });
