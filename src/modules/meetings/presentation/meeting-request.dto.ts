import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import {
  ConsultationType,
  CustomerType,
  MeetingFormat,
  MeetingPriority,
  MeetingRequestStatus,
} from '../domain/meeting-request.types';

export class CreateMeetingRequestDto {
  @ApiProperty({ description: 'Customer full name', example: 'Alice Nguyen' })
  @IsString()
  @IsNotEmpty()
  fullName!: string;

  @ApiProperty({ description: 'Customer company or organization', example: 'Vietcombank Enterprise' })
  @IsString()
  @IsNotEmpty()
  companyName!: string;

  @ApiProperty({ description: 'Customer business email', example: 'alice.nguyen@vietcombank.com.vn' })
  @IsEmail()
  email!: string;

  @ApiPropertyOptional({ description: 'Customer phone number', example: '+84901234567' })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({ enum: CustomerType, default: CustomerType.PROSPECT })
  @IsEnum(CustomerType)
  @IsOptional()
  customerType?: CustomerType;

  @ApiProperty({ description: 'Meeting topic or consultation subject', example: 'Core Banking BMS to React 19 Modernization' })
  @IsString()
  @IsNotEmpty()
  topic!: string;

  @ApiPropertyOptional({ enum: ConsultationType, default: ConsultationType.SALES_SERVICE })
  @IsEnum(ConsultationType)
  @IsOptional()
  consultationType?: ConsultationType;

  @ApiPropertyOptional({ enum: MeetingPriority, default: MeetingPriority.MEDIUM })
  @IsEnum(MeetingPriority)
  @IsOptional()
  priority?: MeetingPriority;

  @ApiPropertyOptional({ enum: ['ALSM_MANAGED', 'CUSTOMER_SELF_SERVICE', 'HYBRID'], default: 'ALSM_MANAGED' })
  @IsOptional()
  serviceMode?: 'ALSM_MANAGED' | 'CUSTOMER_SELF_SERVICE' | 'HYBRID';

  @ApiPropertyOptional({ description: 'Legacy architecture type', example: 'IBM 3270 BMS & COBOL CICS' })
  @IsString()
  @IsOptional()
  legacySystemType?: string;

  @ApiPropertyOptional({ description: 'Current technology stack', example: 'z/OS Mainframe, DB2, CICS v5.4' })
  @IsString()
  @IsOptional()
  currentTechnology?: string;

  @ApiPropertyOptional({ description: 'Estimated screen count', example: 120 })
  @IsNumber()
  @IsOptional()
  estimatedScreens?: number;

  @ApiPropertyOptional({ description: 'Estimated program count', example: 45 })
  @IsNumber()
  @IsOptional()
  estimatedPrograms?: number;

  @ApiPropertyOptional({ enum: ['SMALL', 'MEDIUM', 'LARGE', 'ENTERPRISE'], default: 'MEDIUM' })
  @IsOptional()
  estimatedProjectScale?: 'SMALL' | 'MEDIUM' | 'LARGE' | 'ENTERPRISE';

  @ApiPropertyOptional({ description: 'Business requirements description' })
  @IsString()
  @IsOptional()
  businessRequirements?: string;

  @ApiPropertyOptional({ description: 'Technical requirements description' })
  @IsString()
  @IsOptional()
  technicalRequirements?: string;

  @ApiPropertyOptional({ description: 'Expected timeline for delivery', example: 'Q1-Q2 2027' })
  @IsString()
  @IsOptional()
  expectedTimeline?: string;

  @ApiPropertyOptional({ description: 'Customer preferred date', example: '2026-11-20' })
  @IsString()
  @IsOptional()
  requestedDate?: string;

  @ApiPropertyOptional({ description: 'Customer preferred time', example: '14:30' })
  @IsString()
  @IsOptional()
  requestedTime?: string;

  @ApiPropertyOptional({ description: 'Preferred timezone', example: 'Asia/Ho_Chi_Minh' })
  @IsString()
  @IsOptional()
  timezone?: string;

  @ApiPropertyOptional({ description: 'Initial notes or remarks' })
  @IsString()
  @IsOptional()
  message?: string;

  @ApiPropertyOptional({ description: 'Organization ID' })
  @IsString()
  @IsOptional()
  organizationId?: string;

  @ApiPropertyOptional({ description: 'Linked Project ID' })
  @IsString()
  @IsOptional()
  projectId?: string;

  @ApiPropertyOptional({ description: 'Linked Project Name' })
  @IsString()
  @IsOptional()
  projectName?: string;

  @ApiPropertyOptional({ description: 'Attendee emails' })
  @IsArray()
  @IsOptional()
  attendeeEmails?: string[];

  @ApiPropertyOptional({ description: 'Duration in minutes', example: 45 })
  @IsNumber()
  @IsOptional()
  durationMinutes?: number;
}

export class ListMeetingRequestsQueryDto {
  @ApiPropertyOptional({ description: 'Search customer name, company, email, topic, or request ID' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ enum: MeetingRequestStatus })
  @IsEnum(MeetingRequestStatus)
  @IsOptional()
  status?: MeetingRequestStatus;

  @ApiPropertyOptional({ enum: ConsultationType })
  @IsEnum(ConsultationType)
  @IsOptional()
  consultationType?: ConsultationType;

  @ApiPropertyOptional({ enum: MeetingPriority })
  @IsEnum(MeetingPriority)
  @IsOptional()
  priority?: MeetingPriority;

  @ApiPropertyOptional({ description: 'Assigned Sales User ID' })
  @IsString()
  @IsOptional()
  assignedSalesId?: string;

  @ApiPropertyOptional({ description: 'Organization ID' })
  @IsString()
  @IsOptional()
  organizationId?: string;

  @ApiPropertyOptional({ description: 'Project ID' })
  @IsString()
  @IsOptional()
  projectId?: string;

  @ApiPropertyOptional({ description: 'Filter created on or after Date (ISO string)' })
  @IsString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ description: 'Filter created on or before Date (ISO string)' })
  @IsString()
  @IsOptional()
  endDate?: string;

  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({ default: 10 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  limit?: number = 10;

  @ApiPropertyOptional({ default: 'createdAt' })
  @IsString()
  @IsOptional()
  sortBy?: string = 'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsEnum(['asc', 'desc'])
  @IsOptional()
  sortOrder?: 'asc' | 'desc' = 'desc';
}

export class AssignSalesDto {
  @ApiProperty({ description: 'Assigned sales representative User ID' })
  @IsString()
  @IsNotEmpty()
  salesUserId!: string;

  @ApiPropertyOptional({ description: 'Sales rep display name' })
  @IsString()
  @IsOptional()
  salesName?: string;

  @ApiPropertyOptional({ description: 'Sales rep email' })
  @IsEmail()
  @IsOptional()
  salesEmail?: string;

  @ApiPropertyOptional({ description: 'Internal assignment instructions or handover context' })
  @IsString()
  @IsOptional()
  note?: string;
}

export class ProposeMeetingSlotItemDto {
  @ApiProperty({ description: 'Slot start time ISO 8601', example: '2026-11-20T09:00:00.000Z' })
  @IsString()
  @IsNotEmpty()
  startTime!: string;

  @ApiProperty({ description: 'Slot end time ISO 8601', example: '2026-11-20T09:45:00.000Z' })
  @IsString()
  @IsNotEmpty()
  endTime!: string;
}

export class ProposeMeetingSlotsDto {
  @ApiProperty({ type: [ProposeMeetingSlotItemDto], description: 'Proposed meeting slots' })
  @IsArray()
  @IsNotEmpty()
  slots!: ProposeMeetingSlotItemDto[];

  @ApiPropertyOptional({ description: 'Communication message accompanying the proposed slots' })
  @IsString()
  @IsOptional()
  message?: string;
}

export class ConfirmMeetingDto {
  @ApiProperty({ description: 'Scheduled start time ISO 8601', example: '2026-11-20T09:00:00.000Z' })
  @IsString()
  @IsNotEmpty()
  scheduledStartTime!: string;

  @ApiProperty({ description: 'Scheduled end time ISO 8601', example: '2026-11-20T09:45:00.000Z' })
  @IsString()
  @IsNotEmpty()
  scheduledEndTime!: string;

  @ApiPropertyOptional({ enum: MeetingFormat, default: MeetingFormat.GOOGLE_MEET })
  @IsEnum(MeetingFormat)
  @IsOptional()
  format?: MeetingFormat;

  @ApiPropertyOptional({ description: 'Custom Google Meet URL if not generating automatically' })
  @IsString()
  @IsOptional()
  customMeetingUrl?: string;

  @ApiPropertyOptional({ description: 'Generate Google Meet via Google Calendar API', default: true })
  @IsOptional()
  createGoogleMeet?: boolean;
}

export class RescheduleMeetingDto {
  @ApiProperty({ description: 'New scheduled start time ISO 8601' })
  @IsString()
  @IsNotEmpty()
  scheduledStartTime!: string;

  @ApiProperty({ description: 'New scheduled end time ISO 8601' })
  @IsString()
  @IsNotEmpty()
  scheduledEndTime!: string;

  @ApiProperty({ description: 'Reason for rescheduling' })
  @IsString()
  @IsNotEmpty()
  reason!: string;
}

export class CancelMeetingDto {
  @ApiProperty({ description: 'Reason for meeting cancellation' })
  @IsString()
  @IsNotEmpty()
  reason!: string;
}

export class RecordOutcomeDto {
  @ApiProperty({ description: 'Executive consultation summary and key discussion points' })
  @IsString()
  @IsNotEmpty()
  summary!: string;

  @ApiPropertyOptional({ description: 'Qualification score 1-100', example: 85 })
  @IsNumber()
  @IsOptional()
  qualificationScore?: number;

  @ApiPropertyOptional({ description: 'Agreed next steps or follow-up action items' })
  @IsString()
  @IsOptional()
  nextSteps?: string;
}

export class AddInternalNoteDto {
  @ApiProperty({ description: 'Private internal staff note content' })
  @IsString()
  @IsNotEmpty()
  content!: string;
}

export class CreateEnterpriseQuoteFromMeetingDto {
  @ApiPropertyOptional({ description: 'Target plan name', default: 'Enterprise Modernization Plan' })
  @IsString()
  @IsOptional()
  planName?: string = 'Enterprise Modernization Plan';

  @ApiPropertyOptional({ description: 'Target custom contract or quote title' })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiPropertyOptional({ description: 'Estimated screen volume commitment' })
  @IsNumber()
  @IsOptional()
  screenCount?: number;

  @ApiPropertyOptional({ description: 'Project scope description' })
  @IsString()
  @IsOptional()
  projectScope?: string;

  @ApiPropertyOptional({ description: 'Base quote amount (VND)', default: 50000000 })
  @IsNumber()
  @IsOptional()
  amount: number = 50000000;

  @ApiPropertyOptional({ description: 'Discount percent (0-100)', default: 0 })
  @IsNumber()
  @IsOptional()
  discountPercent?: number = 0;

  @ApiPropertyOptional({ description: 'Discount reason' })
  @IsString()
  @IsOptional()
  discountReason?: string;

  @ApiPropertyOptional({ description: 'Contract duration in months' })
  @IsNumber()
  @IsOptional()
  contractDurationMonths?: number;

  @ApiPropertyOptional({ description: 'Commercial notes or agreed discount rate' })
  @IsString()
  @IsOptional()
  notes?: string;
}
