import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { SUPPORT_PATCH_DATA_TYPES, SupportPatchDataType } from '../domain/support-patch.types';

@Schema({ _id: false })
export class SupportPatchRuleEntry {
  @Prop({ required: true, trim: true }) sourceField!: string;
  @Prop({ required: true, trim: true }) targetProperty!: string;
  @Prop({ required: true, enum: SUPPORT_PATCH_DATA_TYPES }) dataType!: SupportPatchDataType;
  @Prop({ trim: true }) transformRule?: string;
}

const SupportPatchRuleEntrySchema = SchemaFactory.createForClass(SupportPatchRuleEntry);

export type SupportPatchDocument = HydratedDocument<SupportPatch>;

/** One support patch applied by Conversion Staff to a failed conversion job. */
@Schema({ collection: 'conversion_support_patches', timestamps: true })
export class SupportPatch {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true }) organizationId!: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true }) projectId!: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true }) jobId!: Types.ObjectId;
  @Prop() screenId?: string;
  @Prop({ type: [SupportPatchRuleEntrySchema], default: [] }) rules!: SupportPatchRuleEntry[];
  @Prop({ required: true, trim: true }) note!: string;
  @Prop({ required: true, min: 0 }) changedRuleCount!: number;
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true }) appliedBy!: Types.ObjectId;
  @Prop({ required: true }) appliedAt!: Date;
  createdAt!: Date;
  updatedAt!: Date;
}

export const SupportPatchSchema = SchemaFactory.createForClass(SupportPatch);
SupportPatchSchema.index({ organizationId: 1, jobId: 1, appliedAt: -1 });
