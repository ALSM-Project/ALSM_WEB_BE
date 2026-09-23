import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { FindingSeverity, FindingStatus, ValidatorType } from '../domain/validation.types';

export type ValidationRunDocument = HydratedDocument<ValidationRun>;
export type ValidationFindingDocument = HydratedDocument<ValidationFinding>;

@Schema({ collection: 'validation_runs', timestamps: true })
export class ValidationRun {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  conversionJobId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  projectId!: Types.ObjectId;

  @Prop({ required: true, index: true })
  screenId!: string;

  @Prop({ required: true, enum: ['RUNNING', 'COMPLETED', 'FAILED'], default: 'COMPLETED' })
  status!: 'RUNNING' | 'COMPLETED' | 'FAILED';

  @Prop({ default: 0 })
  totalFindings!: number;

  @Prop({ default: 0 })
  openCount!: number;

  @Prop({ default: 0 })
  confirmedCount!: number;

  @Prop({ default: 0 })
  rejectedCount!: number;

  @Prop({ default: 0 })
  resolvedCount!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export const ValidationRunSchema = SchemaFactory.createForClass(ValidationRun);

@Schema({ collection: 'validation_findings', timestamps: true })
export class ValidationFinding {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  conversionJobId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  validationRunId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  projectId!: Types.ObjectId;

  @Prop({ required: true, index: true })
  screenId!: string;

  @Prop({ default: 'Rule Validator' })
  source!: string;

  @Prop({ enum: ValidatorType, default: ValidatorType.RULE_VALIDATOR })
  validatorType!: ValidatorType;

  @Prop({ required: true })
  issueType!: string;

  @Prop({ enum: FindingSeverity, default: FindingSeverity.MEDIUM })
  severity!: FindingSeverity;

  @Prop({ required: true })
  sourceLocation!: string;

  @Prop({ required: true })
  targetLocation!: string;

  @Prop({ required: true })
  expectedBehavior!: string;

  @Prop({ required: true })
  actualBehavior!: string;

  @Prop({ required: true })
  explanation!: string;

  @Prop({ required: true })
  suggestion!: string;

  @Prop({ enum: FindingStatus, default: FindingStatus.OPEN })
  status!: FindingStatus;

  @Prop({ type: Number })
  confidence?: number;

  @Prop()
  reviewDecision?: string;

  @Prop()
  reviewedBy?: string;

  @Prop()
  reviewedAt?: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export const ValidationFindingSchema = SchemaFactory.createForClass(ValidationFinding);
