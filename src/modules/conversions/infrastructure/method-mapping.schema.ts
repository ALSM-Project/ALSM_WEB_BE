import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type MethodMappingDocument = HydratedDocument<MethodMapping>;

@Schema({ _id: false })
export class MethodMappingEntry {
  @Prop({ required: true })
  relativePath!: string;

  @Prop({ required: true, enum: ['CLASS', 'METHOD'] })
  kind!: 'CLASS' | 'METHOD';

  @Prop({ required: true })
  originalName!: string;

  @Prop({ required: true })
  targetName!: string;
}

const MethodMappingEntrySchema = SchemaFactory.createForClass(MethodMappingEntry);

@Schema({ collection: 'method_mappings', timestamps: true })
export class MethodMapping {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  organizationId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  projectId!: Types.ObjectId;

  @Prop({ required: true })
  screenId!: string;

  @Prop({ type: [MethodMappingEntrySchema], default: [] })
  entries!: MethodMappingEntry[];

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  updatedBy!: Types.ObjectId;

  createdAt!: Date;
  updatedAt!: Date;
}

export const MethodMappingSchema = SchemaFactory.createForClass(MethodMapping);
MethodMappingSchema.index({ organizationId: 1, projectId: 1, screenId: 1 }, { unique: true });
