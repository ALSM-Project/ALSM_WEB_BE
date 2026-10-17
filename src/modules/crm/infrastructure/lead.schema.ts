import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongoSchema, Types } from 'mongoose';
import { LeadAssignment, LeadConversion, LeadStatus } from '../domain/lead.types';
@Schema({ collection: 'leads', timestamps: true })
export class Lead {
  @Prop({ enum: LeadStatus, required: true }) status!: LeadStatus;
  @Prop({ type: MongoSchema.Types.ObjectId, required: true }) organizationId!: Types.ObjectId;
  @Prop({ required: true, maxlength: 120 }) title!: string;
  @Prop({ required: true, maxlength: 200 }) sourceReference!: string;
  @Prop() contactEmail?: string;
  @Prop({ required: true }) creationFingerprint!: string;
  @Prop({ required: true }) revision!: number;
  @Prop({ type: [Object], required: true }) assignments!: LeadAssignment[];
  @Prop({ type: Object }) conversion?: LeadConversion;
}
export const LeadSchema = SchemaFactory.createForClass(Lead);
LeadSchema.index({ organizationId: 1, 'assignments.teamId': 1, 'assignments.startedAt': 1 });
LeadSchema.index(
  { organizationId: 1, sourceReference: 1 },
  { unique: true, name: 'one_lead_per_source_reference' },
);
