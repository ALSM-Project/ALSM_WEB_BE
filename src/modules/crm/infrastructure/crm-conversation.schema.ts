import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongoSchema, Types } from 'mongoose';

export type CrmConversationDocument = HydratedDocument<CrmConversation>;

export enum ConversationStatus {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  WAITING_ON_CUSTOMER = 'WAITING_ON_CUSTOMER',
  CLOSED = 'CLOSED',
}

export enum ConversationChannel {
  EMAIL = 'EMAIL',
  PORTAL = 'PORTAL',
  PHONE = 'PHONE',
  CHAT = 'CHAT',
}

@Schema({ collection: 'crm_conversations', timestamps: true })
export class CrmConversation {
  @Prop({ required: true, trim: true })
  title!: string;

  @Prop({ enum: ConversationStatus, default: ConversationStatus.OPEN, index: true })
  status!: ConversationStatus;

  @Prop({ enum: ConversationChannel, default: ConversationChannel.PORTAL })
  channel!: ConversationChannel;

  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'Lead', index: true })
  leadId?: Types.ObjectId;

  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'Organization', index: true })
  organizationId?: Types.ObjectId;

  @Prop({ required: true, trim: true })
  customerName!: string;

  @Prop({ required: true, trim: true, lowercase: true, index: true })
  customerEmail!: string;

  @Prop({ trim: true })
  customerPhone?: string;

  @Prop({ trim: true })
  companyName?: string;

  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'User' })
  assignedToUserId?: Types.ObjectId;

  @Prop({ trim: true })
  assignedToEmail?: string;

  @Prop({ trim: true })
  assignedToName?: string;

  @Prop({ trim: true })
  lastMessage?: string;

  @Prop()
  lastMessageAt?: Date;

  @Prop({ default: 0 })
  unreadCount!: number;

  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'Project', index: true })
  projectId?: Types.ObjectId;

  @Prop({ trim: true })
  projectName?: string;

  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'ConversionRequest', index: true })
  conversionRequestId?: Types.ObjectId;

  @Prop({ trim: true })
  requestNumber?: string;

  @Prop({ enum: ['PROJECT', 'SUPPORT', 'GENERAL'], default: 'PROJECT', index: true })
  conversationType?: 'PROJECT' | 'SUPPORT' | 'GENERAL';

  @Prop({ type: [Object], default: [] })
  participants?: Array<{
    userId?: string;
    email: string;
    name: string;
    role: string;
    type: 'CUSTOMER' | 'ALSM';
  }>;
}

export const CrmConversationSchema = SchemaFactory.createForClass(CrmConversation);
