import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { ConversionPriority, ConversionJobStatus } from '../domain/conversion-job.types';
import { ConversionType } from '../../projects/domain/project.types';
export type ConversionJobDocument = HydratedDocument<ConversionJob>;
@Schema({ collection: 'conversion_jobs', timestamps: true })
export class ConversionJob {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  organizationId!: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  projectId!: Types.ObjectId;
  @Prop({ index: true }) screenId?: string;
  @Prop({ enum: ConversionType, required: true }) conversionType!: ConversionType;
  @Prop({ enum: ConversionJobStatus, required: true }) status!: ConversionJobStatus;
  @Prop({ enum: ConversionPriority, required: true }) priority!: ConversionPriority;
  @Prop({ default: 0 }) attemptCount!: number;
  @Prop({ default: 3 }) maxAttempts!: number;
  @Prop() inputReference?: string;
  @Prop() resultReference?: string;
  @Prop() errorCode?: string;
  @Prop() errorMessage?: string;
  @Prop() toolVersion?: string;
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true }) createdBy!: Types.ObjectId;
  @Prop() startedAt?: Date;
  @Prop() completedAt?: Date;
  createdAt!: Date;
  updatedAt!: Date;
}
export const ConversionJobSchema = SchemaFactory.createForClass(ConversionJob);
ConversionJobSchema.index({ organizationId: 1, projectId: 1, createdAt: -1 });
ConversionJobSchema.index({ organizationId: 1, projectId: 1, screenId: 1, createdAt: -1 });
