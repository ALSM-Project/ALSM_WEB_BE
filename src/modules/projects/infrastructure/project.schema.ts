import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { ConversionType, ProjectStatus } from '../domain/project.types';
export type ProjectDocument = HydratedDocument<Project>;
@Schema({ collection: 'projects', timestamps: true })
export class Project {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  organizationId!: Types.ObjectId;
  @Prop({ required: true, trim: true }) name!: string;
  @Prop({ trim: true }) description?: string;
  @Prop({ enum: ConversionType, required: true }) conversionType!: ConversionType;
  @Prop({ enum: ProjectStatus, default: ProjectStatus.DRAFT }) status!: ProjectStatus;
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true }) createdBy!: Types.ObjectId;
  @Prop() deletedAt?: Date;
  createdAt!: Date;
  updatedAt!: Date;
}
export const ProjectSchema = SchemaFactory.createForClass(Project);
ProjectSchema.index({ organizationId: 1, deletedAt: 1, createdAt: -1 });
