import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { ValidationRunStatus } from '../domain/validation-run.types';

export type ValidationRunDocument = HydratedDocument<ValidationRun>;

@Schema({ collection: 'validation_runs', timestamps: true })
export class ValidationRun {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  organizationId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  projectId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  conversionJobId!: Types.ObjectId;

  @Prop() screenId?: string;

  @Prop({ enum: ValidationRunStatus, required: true })
  status!: ValidationRunStatus;

  @Prop({ required: true }) ruleValidationEnabled!: boolean;
  @Prop({ required: true }) aiValidationEnabled!: boolean;
  @Prop({ required: true, min: 0 }) findingCount!: number;
  @Prop() provider?: string;
  @Prop() model?: string;
  @Prop() promptVersion?: string;
  @Prop({ min: 0 }) redactionCount?: number;
  @Prop({ min: 0 }) selectedFileCount?: number;
  @Prop({ min: 0 }) inputCharacterCount?: number;
  @Prop() failureCode?: string;
  @Prop() failureMessage?: string;
  @Prop() startedAt?: Date;
  @Prop() completedAt?: Date;

  /** Internal uniqueness claim; never mapped to the application/API record. */
  @Prop() activeExecutionKey?: string;

  createdAt!: Date;
  updatedAt!: Date;
}

export const ValidationRunSchema = SchemaFactory.createForClass(ValidationRun);
ValidationRunSchema.index({
  organizationId: 1,
  projectId: 1,
  conversionJobId: 1,
  createdAt: -1,
});
ValidationRunSchema.index(
  { activeExecutionKey: 1 },
  { unique: true, sparse: true, name: 'unique_active_ai_validation_execution' },
);
