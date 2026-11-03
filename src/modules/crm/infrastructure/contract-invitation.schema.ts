import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongoSchema, Types } from 'mongoose';
import {
  ContractInvitationDeliveryStatus,
  ContractInvitationStatus,
} from '../domain/contract-invitation.types';

export type ContractInvitationDocument = HydratedDocument<ContractInvitation>;

@Schema({ collection: 'contract_invitations', timestamps: true })
export class ContractInvitation {
  @Prop({ type: MongoSchema.Types.ObjectId, required: true, index: true }) leadId!: Types.ObjectId;
  @Prop({ type: MongoSchema.Types.ObjectId, required: true, index: true }) organizationId!: Types.ObjectId;
  @Prop({ required: true, lowercase: true, trim: true }) email!: string;
  @Prop({ type: MongoSchema.Types.ObjectId, required: true }) createdByUserId!: Types.ObjectId;
  @Prop({ required: true }) createRequestId!: string;
  @Prop({ required: true, unique: true, select: false }) tokenHash!: string;
  @Prop({ required: true, enum: ['ACTIVE', 'REVOKED', 'CONSUMED', 'EXPIRED'], default: 'ACTIVE' })
  status!: ContractInvitationStatus;
  @Prop({ required: true, enum: ['PENDING', 'SENT', 'NOT_CONFIGURED', 'FAILED', 'UNCONFIRMED'], default: 'PENDING' })
  deliveryStatus!: ContractInvitationDeliveryStatus;
  @Prop({ required: true, index: true }) expiresAt!: Date;
  @Prop() revokedAt?: Date;
  @Prop() consumedAt?: Date;
  @Prop({ type: MongoSchema.Types.ObjectId }) consumedByUserId?: Types.ObjectId;
  @Prop({ type: MongoSchema.Types.ObjectId }) registrationUserId?: Types.ObjectId;
  @Prop({ select: false }) registrationClaimId?: string;
  @Prop({ select: false }) registrationClaimExpiresAt?: Date;
  @Prop() lastDeliveryAttemptAt?: Date;
  @Prop() lastResendRequestId?: string;
  createdAt!: Date;
  updatedAt!: Date;
}

export const ContractInvitationSchema = SchemaFactory.createForClass(ContractInvitation);
ContractInvitationSchema.index(
  { createdByUserId: 1, leadId: 1, organizationId: 1, createRequestId: 1 },
  { unique: true, name: 'contract_invitation_create_idempotency' },
);
ContractInvitationSchema.index(
  { leadId: 1, email: 1 },
  {
    unique: true,
    name: 'one_active_contract_invitation_per_lead_email',
    partialFilterExpression: { status: 'ACTIVE' },
  },
);
ContractInvitationSchema.index({ leadId: 1, organizationId: 1, createdAt: -1 });

export type ContractAccessGrantDocument = HydratedDocument<ContractAccessGrant>;

@Schema({ collection: 'contract_access_grants', timestamps: true })
export class ContractAccessGrant {
  @Prop({ type: MongoSchema.Types.ObjectId, required: true, index: true }) leadId!: Types.ObjectId;
  @Prop({ type: MongoSchema.Types.ObjectId, required: true, index: true }) userId!: Types.ObjectId;
  @Prop({ type: MongoSchema.Types.ObjectId, required: true }) invitationId!: Types.ObjectId;
  @Prop({ required: true, enum: ['ACTIVE'], default: 'ACTIVE' }) status!: 'ACTIVE';
  @Prop({ required: true, enum: ['UNVERIFIED'], default: 'UNVERIFIED' })
  phoneVerificationStatus!: 'UNVERIFIED';
  @Prop({ required: true, enum: ['BLOCKED_PHONE_UNVERIFIED'], default: 'BLOCKED_PHONE_UNVERIFIED' })
  signingEligibility!: 'BLOCKED_PHONE_UNVERIFIED';
  createdAt!: Date;
  updatedAt!: Date;
}

export const ContractAccessGrantSchema = SchemaFactory.createForClass(ContractAccessGrant);
ContractAccessGrantSchema.index(
  { userId: 1, leadId: 1 },
  { unique: true, name: 'one_contract_access_grant_per_user_lead' },
);

export type PublicInvitationRateLimitDocument = HydratedDocument<PublicInvitationRateLimit>;

@Schema({ collection: 'public_invitation_rate_limits', timestamps: false })
export class PublicInvitationRateLimit {
  @Prop({ required: true, unique: true, select: false }) bucketKey!: string;
  @Prop({ required: true, default: 0 }) count!: number;
  @Prop({ required: true, index: { expires: 0 } }) expiresAt!: Date;
}

export const PublicInvitationRateLimitSchema = SchemaFactory.createForClass(
  PublicInvitationRateLimit,
);
