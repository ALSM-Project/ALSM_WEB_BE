import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type TransferRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export type ResourceTransferRequestDocument = ResourceTransferRequest &
  Document & {
    createdAt: Date;
    updatedAt: Date;
  };

@Schema({ collection: 'resource_transfer_requests', timestamps: true })
export class ResourceTransferRequest {
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true, index: true })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Project', required: true, index: true })
  projectId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  projectName!: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: false })
  currentAssigneeId?: Types.ObjectId;

  @Prop({ trim: true, default: 'Unallocated' })
  currentAssigneeName?: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  targetAssigneeId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  targetAssigneeName!: string;

  @Prop({ trim: true })
  targetAssigneeEmail?: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  requestedById!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  requestedByName!: string;

  @Prop({ trim: true, default: 'Workload Balancing' })
  reason!: string;

  @Prop({ trim: true, default: '' })
  note!: string;

  @Prop({
    type: String,
    enum: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'],
    default: 'PENDING',
    index: true,
  })
  status!: TransferRequestStatus;

  @Prop({ type: Types.ObjectId, ref: 'User', required: false })
  reviewedById?: Types.ObjectId;

  @Prop({ trim: true })
  reviewedByName?: string;

  @Prop({ type: Date, required: false })
  reviewedAt?: Date;

  @Prop({ trim: true, default: '' })
  reviewNote?: string;

  @Prop({ trim: true, default: '' })
  rejectionReason?: string;
}

export const ResourceTransferRequestSchema =
  SchemaFactory.createForClass(ResourceTransferRequest);

ResourceTransferRequestSchema.index({ organizationId: 1, status: 1 });
ResourceTransferRequestSchema.index({ projectId: 1, status: 1 });
