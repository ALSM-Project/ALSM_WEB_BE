import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type ProviderCompanyProfileDocument = HydratedDocument<ProviderCompanyProfile>;

@Schema({ _id: false })
export class SignatoryConfiguration {
  @Prop({ required: true, trim: true })
  signerName!: string;

  @Prop({ required: true, trim: true })
  signerTitle!: string;

  @Prop({ required: true, trim: true, lowercase: true })
  signerEmail!: string;

  @Prop({ required: true, trim: true, default: 'VNPT-CA' })
  digitalCertificateProvider!: string;

  @Prop({ trim: true, default: 'VNPT-ECA-ALSM-01' })
  certificateSerialNumber?: string;

  @Prop({ default: true })
  autoCounterSignEnabled!: boolean;

  @Prop({ trim: true })
  signatureImageUrl?: string;

  @Prop({ trim: true })
  companySealUrl?: string;

  @Prop({ trim: true, default: 'drawn' })
  signatureType?: string;

  @Prop({ trim: true, default: 'overlap' })
  stampPosition?: string;

  @Prop({ trim: true, default: 'cloud_ca' })
  signingMethod?: string;

  @Prop({ trim: true, default: 'active' })
  certificateStatus?: string;

  @Prop({ trim: true })
  certificateValidUntil?: string;
}
export const SignatoryConfigurationSchema = SchemaFactory.createForClass(SignatoryConfiguration);

@Schema({ collection: 'provider_company_profiles', timestamps: true })
export class ProviderCompanyProfile {
  @Prop({ required: true, default: 1 })
  version!: number;

  @Prop({ required: true, default: true, index: true })
  isActive!: boolean;

  @Prop({ required: true, trim: true })
  legalName!: string;

  @Prop({ required: true, trim: true, index: true })
  taxId!: string;

  @Prop({ required: true, trim: true })
  registeredAddress!: string;

  @Prop({ trim: true })
  businessRegistrationNumber?: string;

  @Prop({ required: true, trim: true })
  representativeName!: string;

  @Prop({ required: true, trim: true })
  representativeTitle!: string;

  @Prop({ required: true, trim: true, lowercase: true })
  contactEmail!: string;

  @Prop({ trim: true })
  contactPhone?: string;

  @Prop({ required: true, trim: true })
  bankName!: string;

  @Prop({ required: true, trim: true })
  bankAccountNumber!: string;

  @Prop({ required: true, trim: true })
  bankAccountHolder!: string;

  @Prop({ trim: true })
  companyLogo?: string;

  @Prop({ type: SignatoryConfigurationSchema, required: true })
  signatoryConfig!: SignatoryConfiguration;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  updatedByUserId?: Types.ObjectId;

  @Prop({ trim: true })
  updatedByEmail?: string;

  @Prop({ trim: true, default: 'Initial legal entity setup' })
  changeReason?: string;

  createdAt!: Date;
  updatedAt!: Date;
}

export const ProviderCompanyProfileSchema = SchemaFactory.createForClass(ProviderCompanyProfile);
ProviderCompanyProfileSchema.index({ isActive: 1, version: -1 });
