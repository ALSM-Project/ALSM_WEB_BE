import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  Max,
  IsEmail,
  IsUUID,
  IsInt,
  IsDateString,
  MaxLength,
  Matches,
  MinLength,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LeadStatus, LeadSource, LeadPriority, LeadPhoneCallOutcome } from '../domain/lead.types';

export class CreateLeadDto {
  @ApiProperty({ maxLength: 160 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  companyName!: string;

  @ApiProperty({ maxLength: 120 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  contactName!: string;

  @ApiProperty({ maxLength: 320 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(320)
  contactEmail!: string;

  @ApiPropertyOptional({ maxLength: 30 })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Matches(/^[+()\d .-]{7,30}$/)
  contactPhone?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(100)
  jobTitle?: string;

  @ApiPropertyOptional({ enum: LeadSource, default: LeadSource.WEBSITE })
  @IsOptional()
  @IsEnum(LeadSource)
  source?: LeadSource;

  @ApiPropertyOptional({ enum: LeadPriority, default: LeadPriority.MEDIUM })
  @IsOptional()
  @IsEnum(LeadPriority)
  priority?: LeadPriority;

  @ApiPropertyOptional({ minimum: 0, maximum: 1000000000000, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1000000000000)
  estimatedValue?: number;

  @ApiPropertyOptional({ default: 'USD', pattern: '^[A-Z]{3}$' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

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
  @ApiProperty({ description: 'Stable UUID used to make quote submission retries idempotent' })
  @IsUUID()
  requestId!: string;

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

export class LogPhoneCallDto {
  @ApiProperty({ enum: LeadPhoneCallOutcome, description: 'Result of the phone call' })
  @IsEnum(LeadPhoneCallOutcome)
  outcome!: LeadPhoneCallOutcome;

  @ApiProperty({ minimum: 1, maximum: 480, description: 'Call duration in minutes' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(480)
  durationMinutes!: number;

  @ApiProperty({ maxLength: 500, description: 'Short summary of the call' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  summary!: string;

  @ApiPropertyOptional({ maxLength: 2000, description: 'Additional internal notes' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({ description: 'Optional ISO 8601 follow-up date and time' })
  @IsOptional()
  @IsDateString()
  followUpAt?: string;
}

