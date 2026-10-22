import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { PartnerStatus } from '../domain/partner.types';

export type PartnerDocument = Partner & Document;

@Schema({ collection: 'partners', timestamps: true })
export class Partner {
  @Prop({ required: true, trim: true })
  name!: string;

  /** Stored lower-cased, so the unique index is effectively case-insensitive. */
  @Prop({ required: true, trim: true, lowercase: true, unique: true })
  contactEmail!: string;

  @Prop({ required: true, trim: true })
  contactName!: string;

  @Prop({ required: true, trim: true, lowercase: true })
  primaryDomain!: string;

  @Prop({ trim: true })
  engagementType?: string;

  @Prop({ trim: true })
  assignedStaffName?: string;

  @Prop({ type: String, enum: PartnerStatus, default: PartnerStatus.ACTIVE })
  status!: PartnerStatus;

  @Prop({ type: Types.ObjectId, required: true })
  createdBy!: Types.ObjectId;

  createdAt!: Date;
  updatedAt!: Date;
}

export const PartnerSchema = SchemaFactory.createForClass(Partner);
PartnerSchema.index({ createdAt: -1 });
