import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { OrganizationRole, OrganizationType } from '../domain/organization.types';

export type OrganizationDocument = HydratedDocument<Organization>;

@Schema({ _id: false })
export class OrganizationLegalProfile {
  @Prop({ trim: true, index: true })
  taxId?: string;

  @Prop({ trim: true })
  legalCompanyName?: string;

  @Prop({ trim: true })
  registeredAddress?: string;

  @Prop({ trim: true })
  businessRegistrationNumber?: string;

  @Prop({ trim: true })
  legalRepresentative?: string;

  @Prop({ trim: true })
  representativeTitle?: string;

  @Prop({ trim: true, lowercase: true })
  contactEmail?: string;

  @Prop({ trim: true })
  contactPhone?: string;

  @Prop({ trim: true, default: 'ACTIVE' })
  companyStatus?: string;

  @Prop({ trim: true, default: 'MANUAL_ENTRY' })
  dataSource?: string;

  @Prop({ type: Date })
  lookupTimestamp?: Date;

  @Prop({
    enum: ['UNVERIFIED', 'TAX_VERIFIED', 'REPRESENTATIVE_VERIFIED', 'REJECTED'],
    default: 'UNVERIFIED',
  })
  verificationStatus!: 'UNVERIFIED' | 'TAX_VERIFIED' | 'REPRESENTATIVE_VERIFIED' | 'REJECTED';

  @Prop({ type: Date })
  verifiedAt?: Date;

  @Prop({ trim: true })
  notes?: string;
}
export const OrganizationLegalProfileSchema = SchemaFactory.createForClass(OrganizationLegalProfile);

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
  @Prop({ default: 'TRIAL' }) status!: 'ACTIVE' | 'SUSPENDED' | 'TRIAL';
  @Prop({ default: 'Trial' }) engagementType!: string;
  @Prop({ enum: ['ALSM_MANAGED', 'CUSTOMER_SELF_SERVICE'], default: 'CUSTOMER_SELF_SERVICE' })
  serviceMode?: 'ALSM_MANAGED' | 'CUSTOMER_SELF_SERVICE';
  @Prop({ type: MongooseSchema.Types.ObjectId, index: true, sparse: true })
  contractId?: Types.ObjectId;
  @Prop({ trim: true }) activeContractNumber?: string;
  @Prop() contractExpiresAt?: Date;
  @Prop({
    type: {
      screenCapacity: { type: Number, default: 20 },
      programCapacity: { type: Number, default: 10 },
      projectCapacity: { type: Number, default: 10 },
      userSeats: { type: Number, default: 5 },
      concurrentJobs: { type: Number, default: 2 },
      storageGb: { type: Number, default: 5 },
    },
    default: () => ({ screenCapacity: 20, programCapacity: 10, projectCapacity: 10, userSeats: 5, concurrentJobs: 2, storageGb: 5 }),
  })
  contractCapacity?: {
    screenCapacity: number;
    programCapacity: number;
    projectCapacity: number;
    userSeats: number;
    concurrentJobs: number;
    storageGb: number;
  };
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
  @Prop({ type: OrganizationLegalProfileSchema })
  legalProfile?: OrganizationLegalProfile;

  createdAt!: Date;
  updatedAt!: Date;
}
export const OrganizationSchema = SchemaFactory.createForClass(Organization);
OrganizationSchema.index({ 'members.userId': 1 });
