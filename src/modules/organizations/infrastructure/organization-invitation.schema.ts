import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { OrganizationRole } from '../domain/organization.types';

export type OrganizationInvitationDocument = HydratedDocument<OrganizationInvitation>;

@Schema({ collection: 'organization_invitations', timestamps: true })
export class OrganizationInvitation {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  organizationId!: Types.ObjectId;

  @Prop({ required: true, trim: true, lowercase: true, index: true })
  email!: string;

  @Prop({ trim: true })
  name?: string;

  @Prop({ enum: OrganizationRole, required: true, default: OrganizationRole.MEMBER })
  role!: OrganizationRole;

  @Prop({
    enum: ['PENDING', 'ACCEPTED', 'CANCELLED', 'EXPIRED'],
    default: 'PENDING',
    index: true,
  })
  status!: 'PENDING' | 'ACCEPTED' | 'CANCELLED' | 'EXPIRED';

  @Prop({ required: true, unique: true, index: true })
  token!: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: false })
  invitedBy?: Types.ObjectId;

  @Prop({ type: Date, required: true })
  expiresAt!: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export const OrganizationInvitationSchema = SchemaFactory.createForClass(OrganizationInvitation);
OrganizationInvitationSchema.index({ organizationId: 1, email: 1 });
