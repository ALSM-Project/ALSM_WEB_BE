import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import {
  EmploymentStatus,
  MembershipStatus,
  WorkforceMemberType,
} from '../domain/organization.types';

export type OrganizationMembershipDocument = HydratedDocument<OrganizationMembership>;

@Schema({ collection: 'org_memberships', timestamps: true })
export class OrganizationMembership {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Organization', required: true, index: true })
  organizationId!: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(WorkforceMemberType),
    required: true,
    index: true,
    default: WorkforceMemberType.CUSTOMER_MEMBER,
  })
  memberType!: WorkforceMemberType;

  @Prop({ required: true, trim: true, default: 'MEMBER' })
  role!: string;

  @Prop({
    type: String,
    enum: Object.values(MembershipStatus),
    required: true,
    index: true,
    default: MembershipStatus.ACTIVE,
  })
  status!: MembershipStatus;

  @Prop({ trim: true, index: true })
  employeeCode?: string;

  @Prop({ trim: true })
  department?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Team' })
  teamId?: Types.ObjectId;

  @Prop({ trim: true })
  teamName?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  managerId?: Types.ObjectId;

  @Prop({ trim: true })
  managerName?: string;

  @Prop({
    type: String,
    enum: Object.values(EmploymentStatus),
    default: EmploymentStatus.ACTIVE,
  })
  employmentStatus!: EmploymentStatus;

  @Prop({ type: Date, default: () => new Date() })
  joinedAt!: Date;

  @Prop({ type: Date })
  endedAt?: Date;

  @Prop({ type: Object, default: {} })
  metadata?: Record<string, unknown>;

  createdAt!: Date;
  updatedAt!: Date;
}

export const OrganizationMembershipSchema = SchemaFactory.createForClass(OrganizationMembership);

OrganizationMembershipSchema.index({ userId: 1, organizationId: 1 }, { unique: true });
OrganizationMembershipSchema.index({ organizationId: 1, memberType: 1, status: 1 });
OrganizationMembershipSchema.index({ memberType: 1, status: 1 });
