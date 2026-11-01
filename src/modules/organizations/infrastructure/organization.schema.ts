import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { OrganizationRole, OrganizationType } from '../domain/organization.types';
export type OrganizationDocument = HydratedDocument<Organization>;
@Schema({ _id: false })
export class OrganizationMember {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true }) userId!: Types.ObjectId;
  @Prop({ enum: OrganizationRole, required: true }) role!: OrganizationRole;
}
const OrganizationMemberSchema = SchemaFactory.createForClass(OrganizationMember);
@Schema({ collection: 'organizations', timestamps: true })
export class Organization {
  @Prop({ required: true, trim: true }) name!: string;
  @Prop({ trim: true, lowercase: true, index: { unique: true, sparse: true } }) normalizedName?: string;
  @Prop({ enum: OrganizationType, required: true }) type!: OrganizationType;
  @Prop({ type: [OrganizationMemberSchema], default: [] }) members!: OrganizationMember[];
  @Prop({ trim: true }) domain?: string;
  @Prop({ trim: true }) contactEmail?: string;
  @Prop({ type: MongooseSchema.Types.ObjectId, index: true, unique: true, sparse: true })
  sourceLeadId?: Types.ObjectId;
  @Prop({ trim: true, unique: true, sparse: true }) provisioningRequestId?: string;
  @Prop({ trim: true }) provisioningFingerprint?: string;
  @Prop({ enum: ['PENDING', 'SENT', 'FAILED', 'NOT_REQUIRED'], default: 'NOT_REQUIRED' })
  initialAdminInviteStatus!: 'PENDING' | 'SENT' | 'FAILED' | 'NOT_REQUIRED';
  @Prop({ default: 'ACTIVE' }) status!: 'ACTIVE' | 'SUSPENDED' | 'TRIAL';
  @Prop({ default: 'Trial' }) engagementType!: string;
  @Prop() trialExpiresAt?: Date;
  @Prop({
    type: {
      maxScreens: { type: Number, default: 20 },
      maxPrograms: { type: Number, default: 10 },
      maxStorageGb: { type: Number, default: 5 },
      maxProjects: { type: Number, default: 10 },
      maxConversionsPerMonth: { type: Number, default: 100 },
      aiValidationEnabled: { type: Boolean, default: true },
      trialScreens: { type: Number, default: 15 },
      trialPrograms: { type: Number, default: 8 },
      trialStorageGb: { type: Number, default: 5 },
    },
    default: () => ({ maxScreens: 20, maxPrograms: 10, maxStorageGb: 5 }),
  })
  limits!: {
    maxScreens: number;
    maxPrograms: number;
    maxStorageGb: number;
    maxProjects: number;
    maxConversionsPerMonth: number;
    aiValidationEnabled: boolean;
    trialScreens: number;
    trialPrograms: number;
    trialStorageGb: number;
  };
  createdAt!: Date;
  updatedAt!: Date;
}
export const OrganizationSchema = SchemaFactory.createForClass(Organization);
OrganizationSchema.index({ 'members.userId': 1 });
