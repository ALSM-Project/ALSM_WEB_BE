import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import type { ExportNotificationStatus } from '../domain/export.types';

export type ExportBundleDocument = HydratedDocument<ExportBundle>;

@Schema({ _id: false })
export class ExcludedExportItemEntry {
  @Prop({ required: true }) name!: string;
  @Prop({ required: true }) reason!: string;
}

const ExcludedExportItemEntrySchema = SchemaFactory.createForClass(ExcludedExportItemEntry);

/** A code bundle released to a partner (UC-48). */
@Schema({ collection: 'export_bundles', timestamps: true })
export class ExportBundle {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true }) projectId!: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true }) organizationId!: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId }) partnerId?: Types.ObjectId;
  @Prop({ required: true, trim: true, lowercase: true }) partnerEmail!: string;
  @Prop({ required: true }) packageName!: string;
  @Prop({ required: true, enum: ['ZIP'], default: 'ZIP' }) format!: 'ZIP';
  @Prop({ required: true, min: 0 }) fileSizeBytes!: number;
  @Prop({ required: true, min: 0 }) screensIncluded!: number;
  @Prop({ required: true, min: 0 }) programsIncluded!: number;
  @Prop({ type: [ExcludedExportItemEntrySchema], default: [] })
  excludedItems!: ExcludedExportItemEntry[];
  @Prop() customNotes?: string;
  @Prop({ required: true }) storageReference!: string;
  @Prop({ required: true }) exportedAt!: Date;
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true }) exportedBy!: Types.ObjectId;
  @Prop({ required: true, enum: ['PENDING', 'SENT', 'FAILED'], default: 'PENDING' })
  notificationStatus!: ExportNotificationStatus;
  @Prop() notificationError?: string;
  @Prop() notifiedAt?: Date;
  createdAt!: Date;
  updatedAt!: Date;
}

export const ExportBundleSchema = SchemaFactory.createForClass(ExportBundle);
ExportBundleSchema.index({ organizationId: 1, projectId: 1, exportedAt: -1 });
