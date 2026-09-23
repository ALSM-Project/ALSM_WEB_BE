import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { ScreenSourceType, ScreenStatus } from '../domain/screen.types';
import type { DependencyEntry, ProgramDependencyStatus } from '../../conversions/domain/copybook-dependency.types';

export type ScreenDocument = HydratedDocument<Screen>;

@Schema({ collection: 'screens', timestamps: true })
export class Screen {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  organizationId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  projectId!: Types.ObjectId;

  @Prop({ required: true }) name!: string;
  @Prop({ enum: ScreenSourceType, required: true }) sourceType!: ScreenSourceType;
  @Prop({ enum: ScreenStatus, required: true }) status!: ScreenStatus;
  @Prop({ required: true }) inputReference!: string;
  @Prop() sizeBytes?: number;
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true }) createdBy!: Types.ObjectId;

  // Copybook Dependency Resolver output (COBOL_TO_JAVA screens only) — set once at upload
  // time from a static analysis of COPY statements, never mutated by the conversion engine.
  @Prop({ type: String }) dependencyStatus?: ProgramDependencyStatus;
  @Prop({ type: MongooseSchema.Types.Mixed }) dependencies?: DependencyEntry[];
  @Prop() dependencyAnalyzedAt?: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export const ScreenSchema = SchemaFactory.createForClass(Screen);
ScreenSchema.index({ organizationId: 1, projectId: 1, createdAt: -1 });
