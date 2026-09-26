import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  HUMAN_REVIEW_TARGET_STATUSES,
  HumanReviewTargetStatus,
  MAX_REVIEW_NOTE_LENGTH,
} from '../application/validation-finding-review.policy';
import {
  ValidationFindingCategory,
  ValidationFindingSeverity,
  ValidationFindingSource,
  ValidationFindingStatus,
} from '../domain/validation-finding.types';
import { ValidationRunStatus } from '../domain/validation-run.types';

export class ReviewValidationFindingRequestDto {
  @ApiProperty({ enum: HUMAN_REVIEW_TARGET_STATUSES })
  @IsIn(HUMAN_REVIEW_TARGET_STATUSES)
  status!: HumanReviewTargetStatus;

  @ApiPropertyOptional({ maxLength: MAX_REVIEW_NOTE_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_REVIEW_NOTE_LENGTH)
  reviewNote?: string;
}

export class ValidationRunResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() organizationId!: string;
  @ApiProperty() projectId!: string;
  @ApiProperty() conversionJobId!: string;
  @ApiPropertyOptional() screenId?: string;
  @ApiProperty({ enum: ValidationRunStatus }) status!: ValidationRunStatus;
  @ApiProperty() ruleValidationEnabled!: boolean;
  @ApiProperty() aiValidationEnabled!: boolean;
  @ApiProperty() findingCount!: number;
  @ApiPropertyOptional() provider?: string;
  @ApiPropertyOptional() model?: string;
  @ApiPropertyOptional() promptVersion?: string;
  @ApiPropertyOptional() redactionCount?: number;
  @ApiPropertyOptional() selectedFileCount?: number;
  @ApiPropertyOptional() inputCharacterCount?: number;
  @ApiPropertyOptional() expectedFindingCount?: number;
  @ApiPropertyOptional() resultsPersistedAt?: Date;
  @ApiPropertyOptional() failureCode?: string;
  @ApiPropertyOptional() failureMessage?: string;
  @ApiPropertyOptional() startedAt?: Date;
  @ApiPropertyOptional() completedAt?: Date;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}

export class ValidationCodeLocationResponseDto {
  @ApiPropertyOptional() file?: string;
  @ApiPropertyOptional() startLine?: number;
  @ApiPropertyOptional() endLine?: number;
  @ApiPropertyOptional() snippet?: string;
}

export class ValidationFindingResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() organizationId!: string;
  @ApiProperty() projectId!: string;
  @ApiProperty() conversionJobId!: string;
  @ApiProperty() validationRunId!: string;
  @ApiPropertyOptional() screenId?: string;
  @ApiProperty({ enum: ValidationFindingSource }) source!: ValidationFindingSource;
  @ApiProperty({ enum: ValidationFindingCategory }) category!: ValidationFindingCategory;
  @ApiProperty({ enum: ValidationFindingSeverity }) severity!: ValidationFindingSeverity;
  @ApiProperty({ enum: ValidationFindingStatus }) status!: ValidationFindingStatus;
  @ApiProperty() title!: string;
  @ApiProperty() explanation!: string;
  @ApiPropertyOptional() expectedBehavior?: string;
  @ApiPropertyOptional() actualBehavior?: string;
  @ApiPropertyOptional() suggestion?: string;
  @ApiPropertyOptional({ type: ValidationCodeLocationResponseDto })
  sourceLocation?: ValidationCodeLocationResponseDto;
  @ApiPropertyOptional({ type: ValidationCodeLocationResponseDto })
  targetLocation?: ValidationCodeLocationResponseDto;
  @ApiPropertyOptional({ minimum: 0, maximum: 1 }) confidence?: number;
  @ApiPropertyOptional() modelProvider?: string;
  @ApiPropertyOptional() modelName?: string;
  @ApiPropertyOptional() reviewedBy?: string;
  @ApiPropertyOptional() reviewedAt?: Date;
  @ApiPropertyOptional({ maxLength: MAX_REVIEW_NOTE_LENGTH }) reviewNote?: string;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}
