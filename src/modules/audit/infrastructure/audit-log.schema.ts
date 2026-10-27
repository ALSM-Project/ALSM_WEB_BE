import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
export type AuditLogDocument = HydratedDocument<AuditLog>;
@Schema({ collection: 'audit_logs', timestamps: { createdAt: true, updatedAt: false } })
export class AuditLog {
  createdAt?: Date;
  @Prop({ type: MongooseSchema.Types.ObjectId }) actorUserId?: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId }) organizationId?: Types.ObjectId;
  @Prop({ required: true }) action!: string;
  @Prop({ required: true }) resourceType!: string;
  @Prop() resourceId?: string;
  @Prop() ipAddress?: string;
  @Prop({ type: Object }) metadata?: Record<string, string>;
}
export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);

// ─── Indexes ──────────────────────────────────────────────────────
// Primary listing sort & org-scoped queries
AuditLogSchema.index({ organizationId: 1, createdAt: -1 });
// Filter by actor
AuditLogSchema.index({ actorUserId: 1, createdAt: -1 });
// Filter by action type
AuditLogSchema.index({ action: 1, createdAt: -1 });
// Filter by resource type + id
AuditLogSchema.index({ resourceType: 1, resourceId: 1, createdAt: -1 });
// Global chronological listing (admin view)
AuditLogSchema.index({ createdAt: -1 });
