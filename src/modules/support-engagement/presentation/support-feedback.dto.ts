import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  FEEDBACK_CATEGORIES,
  FeedbackCategory,
  FeedbackStatus,
} from '../infrastructure/support-feedback.schema';

export class CreateFeedbackDto {
  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @ApiProperty({ enum: FEEDBACK_CATEGORIES })
  @IsEnum(FEEDBACK_CATEGORIES)
  category!: FeedbackCategory;

  @ApiProperty({ description: 'Detailed feedback description' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  description!: string;

  @ApiPropertyOptional({ description: 'Optional attachments' })
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

export class UpdateFeedbackStatusDto {
  @ApiProperty({ enum: FeedbackStatus })
  @IsEnum(FeedbackStatus)
  status!: FeedbackStatus;

  @ApiPropertyOptional({ description: 'Optional internal review notes' })
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  staffNotes?: string;
}

export interface SupportFeedbackItem {
  id: string;
  userId: string;
  userEmail: string;
  userName: string;
  organizationId?: string;
  rating: number;
  category: FeedbackCategory;
  description: string;
  attachments: Array<{
    fileId?: string;
    name: string;
    url?: string;
    size?: number;
    mimeType?: string;
  }>;
  status: FeedbackStatus;
  staffNotes?: string;
  reviewedByName?: string;
  reviewedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface FeedbackSummaryResult {
  totalCount: number;
  averageRating: number;
  ratingDistribution: Array<{ rating: number; count: number }>;
  categoryBreakdown: Array<{ category: string; count: number; averageRating: number }>;
  statusBreakdown: Array<{ status: string; count: number }>;
}
