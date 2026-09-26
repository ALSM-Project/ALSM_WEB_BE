import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import {
  ConversionQualityReviewStatus,
  HumanQualityReviewTargetStatus,
  MAX_QUALITY_REVIEW_NOTE_LENGTH,
  QUALITY_SCORE_MAX,
  QUALITY_SCORE_MIN,
} from '../domain/conversion-quality-review.types';

export class SubmitQualityReviewDto {
  @ApiProperty({
    enum: [
      ConversionQualityReviewStatus.ACCEPTED,
      ConversionQualityReviewStatus.NEEDS_REWORK,
      ConversionQualityReviewStatus.FLAGGED,
    ],
    description: 'Target quality review status (ACCEPTED, NEEDS_REWORK, FLAGGED)',
    example: ConversionQualityReviewStatus.ACCEPTED,
  })
  @IsNotEmpty()
  @IsEnum([
    ConversionQualityReviewStatus.ACCEPTED,
    ConversionQualityReviewStatus.NEEDS_REWORK,
    ConversionQualityReviewStatus.FLAGGED,
  ])
  status: HumanQualityReviewTargetStatus;

  @ApiPropertyOptional({
    description: 'Optional or mandatory review comment explaining the decision (max 2000 characters). Required when status is NEEDS_REWORK or FLAGGED.',
    maxLength: MAX_QUALITY_REVIEW_NOTE_LENGTH,
    example: 'Initial conversion quality looks good, structure is intact.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_QUALITY_REVIEW_NOTE_LENGTH)
  reviewNote?: string;

  @ApiPropertyOptional({
    description: 'Rating score between 1 (poor) and 5 (excellent)',
    minimum: QUALITY_SCORE_MIN,
    maximum: QUALITY_SCORE_MAX,
    example: 5,
  })
  @IsOptional()
  @IsInt()
  @Min(QUALITY_SCORE_MIN)
  @Max(QUALITY_SCORE_MAX)
  qualityScore?: number;
}
