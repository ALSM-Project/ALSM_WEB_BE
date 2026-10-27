import {
  IsOptional,
  IsString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  Min,
  Max,
  IsEmail,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LeadStatus, LeadSource, LeadPriority } from '../domain/lead.types';

export class ListLeadsQueryDto {
  @ApiPropertyOptional({ enum: LeadStatus })
  @IsOptional()
  @IsEnum(LeadStatus)
  status?: LeadStatus;

  @ApiPropertyOptional({ enum: LeadSource })
  @IsOptional()
  @IsEnum(LeadSource)
  source?: LeadSource;

  @ApiPropertyOptional({ enum: LeadPriority })
  @IsOptional()
  @IsEnum(LeadPriority)
  priority?: LeadPriority;

  @ApiPropertyOptional({ description: 'Filter by assigned user ID' })
  @IsOptional()
  @IsString()
  assignedToUserId?: string;

  @ApiPropertyOptional({ description: 'Search by company name, contact name, or email' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  limit?: number;

  @ApiPropertyOptional({ description: 'Sort field', default: 'createdAt' })
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc';
}

export class UpdateLeadStatusDto {
  @ApiPropertyOptional({ enum: LeadStatus, description: 'New lead status' })
  @IsEnum(LeadStatus, { message: 'status must be a valid LeadStatus value' })
  status!: LeadStatus;

  @ApiPropertyOptional({ description: 'Optional internal notes or reason for status update', maxLength: 2000 })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class SendQuoteDto {
  @ApiProperty({ description: 'Modernization plan name (e.g. Enterprise Tier 1)' })
  @IsNotEmpty({ message: 'planName cannot be empty' })
  @IsString()
  planName!: string;

  @ApiPropertyOptional({ description: 'Modernization scope description' })
  @IsOptional()
  @IsString()
  projectScope?: string;

  @ApiProperty({ description: 'Quote base amount in USD' })
  @IsNumber({}, { message: 'amount must be a valid number' })
  @Min(1, { message: 'amount must be greater than 0' })
  amount!: number;

  @ApiPropertyOptional({ description: 'Discount percentage (0-100)', default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'discountPercent cannot be negative' })
  @Max(100, { message: 'discountPercent cannot exceed 100' })
  discountPercent?: number;

  @ApiPropertyOptional({ description: 'Justification reason for discount' })
  @IsOptional()
  @IsString()
  discountReason?: string;

  @ApiPropertyOptional({ description: 'Recipient customer email' })
  @IsOptional()
  @IsEmail({}, { message: 'recipientEmail must be a valid email address' })
  recipientEmail?: string;

  @ApiPropertyOptional({ description: 'Quote validity duration in days', default: 30 })
  @IsOptional()
  @IsNumber()
  @Min(1, { message: 'validityDays must be at least 1 day' })
  @Max(365, { message: 'validityDays cannot exceed 365 days' })
  validityDays?: number;

  @ApiPropertyOptional({ description: 'Additional terms or internal notes' })
  @IsOptional()
  @IsString()
  notes?: string;
}

