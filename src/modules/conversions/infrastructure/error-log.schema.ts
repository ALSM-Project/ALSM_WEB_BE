import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ErrorLogSeverity, ErrorLogStatus } from '../domain/error-log.types';

export type ErrorLogDocument = HydratedDocument<ErrorLog>;

@Schema({ _id: false })
class SuggestedPatchSchema {
  @Prop({ required: true }) offendingLine!: string;
  @Prop({ required: true }) suggestedLine!: string;
  @Prop({ required: true }) reason!: string;
}

@Schema({ collection: 'error_logs', timestamps: true })
export class ErrorLog {
  @Prop({ type: Types.ObjectId, required: true, index: true }) organizationId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, required: true, index: true }) projectId!: Types.ObjectId;
  @Prop({ required: true }) screenName!: string;
  @Prop({ required: true }) errorCode!: string;
  @Prop({ enum: ErrorLogSeverity, required: true, index: true }) severity!: ErrorLogSeverity;
  @Prop({ enum: ErrorLogStatus, required: true, default: ErrorLogStatus.UNRESOLVED, index: true }) status!: ErrorLogStatus;
  @Prop({ required: true }) lineNumber!: number;
  @Prop({ required: true }) offendingCode!: string;
  @Prop({ type: SuggestedPatchSchema, required: true }) suggestedPatch!: SuggestedPatchSchema;
  @Prop({ type: Types.ObjectId }) resolvedBy?: Types.ObjectId;
  @Prop() resolvedAt?: Date;
  createdAt!: Date;
  updatedAt!: Date;
}

export const ErrorLogSchema = SchemaFactory.createForClass(ErrorLog);
ErrorLogSchema.index({ organizationId: 1, projectId: 1, createdAt: -1 });
ErrorLogSchema.index({ projectId: 1, severity: 1, status: 1 });
