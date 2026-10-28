import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
export type AuditLogDocument = HydratedDocument<AuditLog>;
@Schema({ collection: 'audit_logs', timestamps: { createdAt: true, updatedAt: false } })
export class AuditLog {
  createdAt?: Date;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' }) actorUserId?: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId }) organizationId?: Types.ObjectId;
  @Prop({ required: true }) action!: string;
  @Prop({ required: true }) resourceType!: string;
  @Prop() resourceId?: string;
  @Prop() ipAddress?: string;
  @Prop({ type: Object }) metadata?: Record<string, string>;
  // TTL field — MongoDB automatically deletes documents once this date passes.
  // Defaults to 7 years after creation (minimum retention per business rules).
  @Prop({ type: Date }) expiresAt?: Date;
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
// 7-year TTL — MongoDB deletes documents when expiresAt is in the past.
AuditLogSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// ─── Pre-save hook: set expiresAt to 7 years from now if not already set ──
const SEVEN_YEARS_MS = 7 * 365.25 * 24 * 60 * 60 * 1000;
AuditLogSchema.pre('save', function (next) {
  if (!this.expiresAt) {
    this.expiresAt = new Date(Date.now() + SEVEN_YEARS_MS);
  }
  next();
});
// Also handle insertMany / create([...]) which bypass save hooks
AuditLogSchema.pre('insertMany', function (_next, docs: AuditLog[]) {
  const now = Date.now();
  for (const doc of docs) {
    if (!doc.expiresAt) {
      doc.expiresAt = new Date(now + SEVEN_YEARS_MS);
    }
  }
  _next();
});
