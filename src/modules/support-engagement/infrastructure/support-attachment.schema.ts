import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongoSchema, Types } from 'mongoose';

export type SupportAttachmentDocument = HydratedDocument<SupportAttachment>;

@Schema({ collection: 'support_attachments', timestamps: true })
export class SupportAttachment {
  @Prop({ required: true, unique: true, index: true })
  fileId!: string;

  @Prop({ required: true })
  originalName!: string;

  @Prop({ required: true })
  storedName!: string;

  @Prop({ required: true })
  mimeType!: string;

  @Prop({ required: true })
  size!: number;

  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  uploadedByUserId!: Types.ObjectId;

  @Prop({ required: true, lowercase: true, trim: true })
  uploadedByEmail!: string;
}

export const SupportAttachmentSchema = SchemaFactory.createForClass(SupportAttachment);
