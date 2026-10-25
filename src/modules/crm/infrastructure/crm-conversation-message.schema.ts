import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongoSchema, Types } from 'mongoose';

export type CrmConversationMessageDocument = HydratedDocument<CrmConversationMessage>;

export enum MessageSenderRole {
  CUSTOMER = 'CUSTOMER',
  SALES_REP = 'SALES_REP',
  STAFF = 'STAFF',
  SYSTEM = 'SYSTEM',
}

@Schema({ collection: 'crm_conversation_messages', timestamps: true })
export class CrmConversationMessage {
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'CrmConversation', required: true, index: true })
  conversationId!: Types.ObjectId;

  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'User' })
  senderUserId?: Types.ObjectId;

  @Prop({ required: true, trim: true })
  senderName!: string;

  @Prop({ required: true, trim: true, lowercase: true })
  senderEmail!: string;

  @Prop({ enum: MessageSenderRole, default: MessageSenderRole.SALES_REP })
  senderRole!: MessageSenderRole;

  @Prop({ required: true })
  content!: string;

  @Prop({ default: false, index: true })
  isInternal!: boolean; // true = private internal note for sales team; false = public message visible to customer

  @Prop({ type: [Object], default: [] })
  attachments?: Array<{
    fileId?: string;
    name: string;
    url?: string;
    size?: number;
    mimeType?: string;
  }>;
}

export const CrmConversationMessageSchema = SchemaFactory.createForClass(CrmConversationMessage);
