import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type FieldMappingDocument = HydratedDocument<FieldMapping>;

@Schema({ _id: false })
export class LegacyFieldDescriptor {
  @Prop({ required: true })
  name!: string;

  @Prop({ required: true })
  type!: string;

  @Prop({ required: true })
  length!: number;

  @Prop({ required: true })
  position!: string;
}

const LegacyFieldDescriptorSchema = SchemaFactory.createForClass(LegacyFieldDescriptor);

@Schema({ _id: false })
export class FieldComponentMapping {
  @Prop({ required: true })
  componentType!: string;

  @Prop({ required: true })
  labelText!: string;

  @Prop({ required: true, default: false })
  isRequired!: boolean;

  @Prop({ required: true, default: 0 })
  minLength!: number;

  @Prop({ required: true, default: 0 })
  maxLength!: number;

  @Prop({ default: '' })
  regexPattern!: string;
}

const FieldComponentMappingSchema = SchemaFactory.createForClass(FieldComponentMapping);

@Schema({ _id: false })
export class FieldMappingEntry {
  @Prop({ type: LegacyFieldDescriptorSchema, required: true })
  legacyField!: LegacyFieldDescriptor;

  @Prop({ type: FieldComponentMappingSchema, required: true })
  componentMapping!: FieldComponentMapping;
}

const FieldMappingEntrySchema = SchemaFactory.createForClass(FieldMappingEntry);

@Schema({ collection: 'field_mappings', timestamps: true })
export class FieldMapping {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  organizationId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  projectId!: Types.ObjectId;

  @Prop({ required: true })
  screenId!: string;

  @Prop({ type: [FieldMappingEntrySchema], default: [] })
  mappings!: FieldMappingEntry[];

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  updatedBy!: Types.ObjectId;

  createdAt!: Date;
  updatedAt!: Date;
}

export const FieldMappingSchema = SchemaFactory.createForClass(FieldMapping);
FieldMappingSchema.index({ organizationId: 1, projectId: 1, screenId: 1 }, { unique: true });
