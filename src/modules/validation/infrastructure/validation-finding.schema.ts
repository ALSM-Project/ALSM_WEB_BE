import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import {
  ValidationFindingCategory,
  ValidationFindingSeverity,
  ValidationFindingSource,
  ValidationFindingStatus,
} from '../domain/validation-finding.types';

export type ValidationFindingDocument = HydratedDocument<ValidationFinding>;

@Schema({ _id: false })
export class CodeLocationSchema {
  @Prop() file?: string;
  @Prop({ min: 1 }) startLine?: number;
  @Prop({ min: 1 }) endLine?: number;
  @Prop() snippet?: string;
}

@Schema({ collection: 'validation_findings', timestamps: true })
export class ValidationFinding {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  organizationId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  projectId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  conversionJobId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  validationRunId!: Types.ObjectId;

  @Prop() screenId?: string;

  @Prop({ enum: ValidationFindingSource, required: true })
  source!: ValidationFindingSource;

  @Prop({ enum: ValidationFindingCategory, required: true })
  category!: ValidationFindingCategory;

  @Prop({ enum: ValidationFindingSeverity, required: true })
  severity!: ValidationFindingSeverity;

  @Prop({ enum: ValidationFindingStatus, required: true })
  status!: ValidationFindingStatus;

  @Prop({ required: true }) title!: string;
  @Prop({ required: true }) explanation!: string;
  @Prop() expectedBehavior?: string;
  @Prop() actualBehavior?: string;
  @Prop() suggestion?: string;
  @Prop({ type: CodeLocationSchema }) sourceLocation?: CodeLocationSchema;
  @Prop({ type: CodeLocationSchema }) targetLocation?: CodeLocationSchema;
  @Prop({ min: 0, max: 1 }) confidence?: number;
  @Prop() modelProvider?: string;
  @Prop() modelName?: string;
  /** Internal retry identity; never mapped to the application/API record. */
  @Prop() fingerprint?: string;
  @Prop({ type: MongooseSchema.Types.ObjectId }) reviewedBy?: Types.ObjectId;
  @Prop() reviewedAt?: Date;
  @Prop({ maxlength: 1000 }) reviewNote?: string;

  createdAt!: Date;
  updatedAt!: Date;
}

export const ValidationFindingSchema = SchemaFactory.createForClass(ValidationFinding);
ValidationFindingSchema.index({
  organizationId: 1,
  projectId: 1,
  validationRunId: 1,
  createdAt: -1,
});
ValidationFindingSchema.index(
  { organizationId: 1, projectId: 1, validationRunId: 1, fingerprint: 1 },
  {
    unique: true,
    partialFilterExpression: { fingerprint: { $type: 'string' } },
    name: 'unique_validation_finding_fingerprint',
  },
);
