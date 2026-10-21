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
  @Prop({ enum: OrganizationType, required: true }) type!: OrganizationType;
  @Prop({ type: [OrganizationMemberSchema], default: [] }) members!: OrganizationMember[];
  @Prop({ trim: true }) domain?: string;
  @Prop({ trim: true }) contactEmail?: string;
  @Prop({ default: 'ACTIVE' }) status!: 'ACTIVE' | 'SUSPENDED' | 'TRIAL';
  @Prop({ default: 'Trial' }) engagementType!: string;
  @Prop() trialExpiresAt?: Date;
  @Prop({
    type: {
      maxScreens: { type: Number, default: 20 },
      maxPrograms: { type: Number, default: 10 },
      maxStorageGb: { type: Number, default: 5 },
    },
    default: () => ({ maxScreens: 20, maxPrograms: 10, maxStorageGb: 5 }),
  })
  limits!: {
    maxScreens: number;
    maxPrograms: number;
    maxStorageGb: number;
  };
  createdAt!: Date;
  updatedAt!: Date;
}
export const OrganizationSchema = SchemaFactory.createForClass(Organization);
OrganizationSchema.index({ 'members.userId': 1 });
