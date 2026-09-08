import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
export type AuditLogDocument = HydratedDocument<AuditLog>;
@Schema({ collection: 'audit_logs', timestamps: { createdAt: true, updatedAt: false } })
export class AuditLog {
  @Prop({ type: MongooseSchema.Types.ObjectId }) actorUserId?: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId }) organizationId?: Types.ObjectId;
  @Prop({ required: true }) action!: string;
  @Prop({ required: true }) resourceType!: string;
  @Prop() resourceId?: string;
  @Prop({ type: Object }) metadata?: Record<string, string>;
}
export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);
AuditLogSchema.index({ organizationId: 1, createdAt: -1 });
