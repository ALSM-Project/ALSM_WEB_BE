import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongoSchema, Types } from 'mongoose';

export type WorkingFileCategory =
  | 'WORKING_DRAFT'
  | 'INTERMEDIATE_CODE'
  | 'ANALYSIS_DOC'
  | 'INTERNAL_NOTE';

@Schema({ collection: 'internal_working_files', timestamps: true })
export class InternalWorkingFileDocument extends Document {
  @Prop({ type: MongoSchema.Types.ObjectId, required: true, index: true })
  projectId!: Types.ObjectId;

  @Prop({ type: MongoSchema.Types.ObjectId, required: true, index: true })
  organizationId!: Types.ObjectId;

  @Prop({ required: true })
  name!: string;

  @Prop({
    required: true,
    enum: [
      'WORKING_DRAFT',
      'INTERMEDIATE_CODE',
      'ANALYSIS_DOC',
      'INTERNAL_NOTE',
    ],
    default: 'WORKING_DRAFT',
  })
  category!: WorkingFileCategory;

  @Prop({ required: true, default: 0 })
  sizeBytes!: number;

  @Prop()
  content?: string;

  @Prop()
  storageUrl?: string;

  @Prop({ required: true })
  uploadedByUserId!: string;

  @Prop({ required: true })
  uploadedByName!: string;

  @Prop({ required: true, default: 'STAFF' })
  uploadedByRole!: string;

  @Prop()
  notes?: string;

  createdAt!: Date;
  updatedAt!: Date;
}

export const InternalWorkingFileSchema = SchemaFactory.createForClass(
  InternalWorkingFileDocument,
);
InternalWorkingFileSchema.index({ projectId: 1, createdAt: -1 });
