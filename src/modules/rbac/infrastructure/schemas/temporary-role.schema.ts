import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type TemporaryRoleDocument = HydratedDocument<TemporaryRole>;

@Schema({ collection: 'temporary_roles', timestamps: true })
export class TemporaryRole {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ required: true, trim: true, index: true })
  roleId!: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  grantedBy!: Types.ObjectId;

  @Prop({ required: true, default: () => new Date() })
  grantedAt!: Date;

  @Prop({ required: true, index: true })
  expiresAt!: Date;

  @Prop({ required: true, default: 24, max: 24 })
  durationHours!: number;

  @Prop({
    required: true,
    enum: ['ACTIVE', 'EXPIRED', 'REVOKED'],
    default: 'ACTIVE',
    index: true,
  })
  status!: 'ACTIVE' | 'EXPIRED' | 'REVOKED';

  @Prop({ required: true, trim: true })
  reason!: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  requestedBy?: Types.ObjectId;

  @Prop({
    enum: ['PENDING', 'APPROVED', 'REJECTED'],
    default: 'APPROVED',
  })
  requestStatus?: 'PENDING' | 'APPROVED' | 'REJECTED';

  @Prop()
  revokedAt?: Date;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  revokedBy?: Types.ObjectId;

  @Prop({ trim: true })
  revocationReason?: string;

  /** Project the elevation was granted for, when the grantor named one. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Project', required: false })
  projectId?: Types.ObjectId;

  createdAt!: Date;
  updatedAt!: Date;
}

export const TemporaryRoleSchema = SchemaFactory.createForClass(TemporaryRole);
TemporaryRoleSchema.index({ userId: 1, status: 1 });
TemporaryRoleSchema.index({ expiresAt: 1, status: 1 });
