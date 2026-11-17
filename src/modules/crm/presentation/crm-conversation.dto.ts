import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ConversationChannel, ConversationStatus } from '../infrastructure/crm-conversation.schema';
import { MessageSenderRole } from '../infrastructure/crm-conversation-message.schema';

export class CreateConversationDto {
  @ApiProperty({ description: 'Subject / title of the conversation' })
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiPropertyOptional({ enum: ConversationChannel, default: ConversationChannel.PORTAL })
  @IsEnum(ConversationChannel)
  @IsOptional()
  channel?: ConversationChannel;

  @ApiPropertyOptional({ description: 'Associated CRM lead ID' })
  @IsString()
  @IsOptional()
  leadId?: string;

  @ApiPropertyOptional({ description: 'Associated Organization ID' })
  @IsString()
  @IsOptional()
  organizationId?: string;

  @ApiPropertyOptional({ description: 'Associated Project ID' })
  @IsString()
  @IsOptional()
  projectId?: string;

  @ApiPropertyOptional({ description: 'Associated Project Name' })
  @IsString()
  @IsOptional()
  projectName?: string;

  @ApiPropertyOptional({ description: 'Associated Managed Modernization Request ID' })
  @IsString()
  @IsOptional()
  conversionRequestId?: string;

  @ApiPropertyOptional({ description: 'Associated Managed Modernization Request Number' })
  @IsString()
  @IsOptional()
  requestNumber?: string;

  @ApiPropertyOptional({ enum: ['PROJECT', 'SUPPORT', 'GENERAL'], default: 'PROJECT' })
  @IsOptional()
  conversationType?: 'PROJECT' | 'SUPPORT' | 'GENERAL';

  @ApiProperty({ description: 'Customer or primary contact name' })
  @IsString()
  @IsNotEmpty()
  customerName!: string;

  @ApiProperty({ description: 'Customer or primary contact email' })
  @IsEmail()
  @IsNotEmpty()
  customerEmail!: string;

  @ApiPropertyOptional({ description: 'Customer contact phone number' })
  @IsString()
  @IsOptional()
  customerPhone?: string;

  @ApiPropertyOptional({ description: 'Customer company or organisation name' })
  @IsString()
  @IsOptional()
  companyName?: string;

  @ApiPropertyOptional({ description: 'First message or initial note to start conversation' })
  @IsString()
  @IsOptional()
  initialMessage?: string;

  @ApiPropertyOptional({ description: 'Whether initial message is an internal staff note', default: false })
  @IsBoolean()
  @IsOptional()
  isInternal?: boolean;

  @ApiPropertyOptional({ description: 'Participants in this conversation' })
  @IsArray()
  @IsOptional()
  participants?: Array<{
    userId?: string;
    email: string;
    name: string;
    role: string;
    type: 'CUSTOMER' | 'ALSM';
  }>;
}

export class PostMessageDto {
  @ApiProperty({ description: 'Message body content' })
  @IsString()
  @IsNotEmpty()
  content!: string;

  @ApiPropertyOptional({ description: 'True if internal note (hidden from customer), false for customer-visible message', default: false })
  @IsBoolean()
  @IsOptional()
  isInternal?: boolean;

  @ApiPropertyOptional({ description: 'Message attachments' })
  @IsArray()
  @IsOptional()
  attachments?: Array<{
    fileId?: string;
    name: string;
    url?: string;
    size?: number;
    mimeType?: string;
  }>;
}

export class UpdateConversationStatusDto {
  @ApiProperty({ enum: ConversationStatus })
  @IsEnum(ConversationStatus)
  status!: ConversationStatus;
}

export interface CrmConversationItem {
  id: string;
  title: string;
  status: ConversationStatus;
  channel: ConversationChannel;
  leadId?: string;
  organizationId?: string;
  projectId?: string;
  projectName?: string;
  conversionRequestId?: string;
  requestNumber?: string;
  conversationType?: 'PROJECT' | 'SUPPORT' | 'GENERAL';
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  companyName?: string;
  assignedToUserId?: string;
  assignedToEmail?: string;
  assignedToName?: string;
  participants?: Array<{
    userId?: string;
    email: string;
    name: string;
    role: string;
    type: 'CUSTOMER' | 'ALSM';
  }>;
  lastMessage?: string;
  lastMessageAt?: Date;
  unreadCount: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CrmConversationMessageItem {
  id: string;
  conversationId: string;
  senderUserId?: string;
  senderName: string;
  senderEmail: string;
  senderRole: MessageSenderRole;
  content: string;
  isInternal: boolean;
  attachments?: Array<{
    fileId?: string;
    name: string;
    url?: string;
    size?: number;
    mimeType?: string;
  }>;
  createdAt: Date;
}

export class ConvertToLeadDto {
  @ApiPropertyOptional({ description: 'Company name if different or missing' })
  @IsString()
  @IsOptional()
  companyName?: string;

  @ApiPropertyOptional({ description: 'Business requirements and modernization scope' })
  @IsString()
  @IsOptional()
  businessRequirements?: string;

  @ApiPropertyOptional({ description: 'Estimated screen count' })
  @IsOptional()
  estimatedScreens?: number;

  @ApiPropertyOptional({ description: 'Estimated program/service count' })
  @IsOptional()
  estimatedPrograms?: number;

  @ApiPropertyOptional({ description: 'Estimated project deal value (VND)' })
  @IsOptional()
  estimatedValue?: number;

  @ApiPropertyOptional({ description: 'Lead priority', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'], default: 'MEDIUM' })
  @IsOptional()
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

  @ApiPropertyOptional({ description: 'Expected close date (ISO string)' })
  @IsOptional()
  expectedCloseDate?: string;

  @ApiPropertyOptional({ description: 'Follow-up date (ISO string)' })
  @IsOptional()
  followUpDate?: string;

  @ApiPropertyOptional({ description: 'Sales representative internal notes' })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiPropertyOptional({ description: 'Existing lead ID if linking rather than creating new' })
  @IsString()
  @IsOptional()
  existingLeadId?: string;
}

export interface ConvertToLeadResult {
  success: boolean;
  leadId: string;
  leadTitle: string;
  stage: string;
  dealValue: number;
  contactEmail: string;
  contactName: string;
  company: string;
  conversationId: string;
  isExistingLinked: boolean;
}

export interface CheckLeadStatusResult {
  isLinked: boolean;
  leadId?: string;
  lead?: {
    id: string;
    title: string;
    stage: string;
    dealValue?: number;
    company?: string;
    contactName?: string;
    contactEmail?: string;
  };
  matchingLeads: Array<{
    id: string;
    title: string;
    stage: string;
    dealValue?: number;
    company?: string;
    contactName?: string;
    contactEmail?: string;
    createdAt?: Date;
  }>;
}
