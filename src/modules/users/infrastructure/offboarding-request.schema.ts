import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { OffboardingRequestStatus } from '../domain/offboarding-request.types';

export type OffboardingRequestDocument = OffboardingRequest &
  Document & {
    createdAt: Date;
    updatedAt: Date;
  };

@Schema({ _id: false })
export class ProjectTransferSchemaItem {
  @Prop({ required: true, trim: true })
  projectId!: string;

  @Prop({ trim: true })
  projectName?: string;

  @Prop({ required: true, trim: true })
  targetStaffId!: string;

  @Prop({ trim: true })
  targetStaffName?: string;

  @Prop({ trim: true })
  reason?: string;
}

export const ProjectTransferSchemaItemDefinition =
  SchemaFactory.createForClass(ProjectTransferSchemaItem);

@Schema({ collection: 'offboarding_requests', timestamps: true })
export class OffboardingRequest {
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true, index: true })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Team', index: true })
  teamId?: Types.ObjectId;

  @Prop({ trim: true })
  teamName?: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  targetUserId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  targetUserName!: string;

  @Prop({ required: true, trim: true })
  targetUserEmail!: string;

  @Prop({ type: [String], default: [] })
  targetUserRoles!: string[];

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  requestedById!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  requestedByName!: string;

  @Prop({ trim: true })
  requestedByEmail?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  transferToUserId?: Types.ObjectId;

  @Prop({ trim: true })
  transferToUserName?: string;

  @Prop({ type: [ProjectTransferSchemaItemDefinition], default: [] })
  projectTransfers?: ProjectTransferSchemaItem[];

  @Prop({ required: true, trim: true })
  reason!: string;

  @Prop({ trim: true, default: '' })
  note?: string;

  @Prop({ trim: true, default: 'Resignation' })
  offboardingType?: string;

  @Prop()
  effectiveDate?: Date;

  @Prop()
  handoverDeadline?: Date;

  @Prop({ trim: true })
  pendingTasks?: string;

  @Prop({ trim: true, default: 'Pending' })
  documentationStatus?: string;

  @Prop({ trim: true })
  department?: string;

  @Prop({ trim: true })
  directManager?: string;

  @Prop({
    type: String,
    enum: [
      'DRAFT',
      'PENDING',
      'PENDING_APPROVAL',
      'APPROVED',
      'REJECTED',
      'HANDOVER_IN_PROGRESS',
      'HANDOVER_COMPLETED',
      'ACCESS_REVOCATION_PENDING',
      'COMPLETED',
      'CANCELLED',
    ],
    default: 'PENDING',
    index: true,
  })
  status!: OffboardingRequestStatus;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  reviewedById?: Types.ObjectId;

  @Prop({ trim: true })
  reviewedByName?: string;

  @Prop()
  reviewedAt?: Date;

  @Prop({ trim: true })
  reviewNote?: string;

  @Prop({ trim: true })
  rejectionReason?: string;

  @Prop({ type: Object })
  executionResult?: Record<string, unknown>;
}

export const OffboardingRequestSchema = SchemaFactory.createForClass(OffboardingRequest);

OffboardingRequestSchema.index({ targetUserId: 1, status: 1 });
OffboardingRequestSchema.index({ organizationId: 1, teamId: 1, status: 1 });
