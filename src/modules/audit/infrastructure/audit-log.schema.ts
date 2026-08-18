import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
export type AuditLogDocument = HydratedDocument<AuditLog>;
@Schema({ collection: 'audit_logs', timestamps: { createdAt: true, updatedAt: false } })
export class AuditLog { @Prop({ type: Types.ObjectId }) actorUserId?: Types.ObjectId; @Prop({ type: Types.ObjectId }) organizationId?: Types.ObjectId; @Prop({ required: true }) action!: string; @Prop({ required: true }) resourceType!: string; @Prop() resourceId?: string; @Prop({ type: Object }) metadata?: Record<string, string>; }
export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);
AuditLogSchema.index({ organizationId: 1, createdAt: -1 });
