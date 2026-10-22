import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNumber, IsOptional, IsString, MinLength } from 'class-validator';
import { DeliverablePackageType } from '../domain/deliverable.types';

export class ReviewDeliverableDto {
  @ApiProperty({ enum: ['APPROVED', 'REVISION_REQUESTED'] })
  @IsEnum(['APPROVED', 'REVISION_REQUESTED'])
  decision!: 'APPROVED' | 'REVISION_REQUESTED';

  @ApiProperty({ required: false, description: 'Explanation if revision is requested' })
  @IsOptional()
  @IsString()
  feedbackNotes?: string;
}

export class TeamLeadReviewDeliverableDto {
  @ApiProperty({ enum: ['APPROVED', 'REVISION_REQUESTED'] })
  @IsEnum(['APPROVED', 'REVISION_REQUESTED'])
  decision!: 'APPROVED' | 'REVISION_REQUESTED';

  @ApiProperty({ required: false, description: 'Notes or feedback for engineers' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateDeliverableCandidateDto {
  @ApiProperty({ description: 'Target Project ID' })
  @IsString()
  projectId!: string;

  @ApiProperty({ description: 'Deliverable Title', example: 'React 19 Frontend Components v1.0' })
  @IsString()
  @MinLength(3)
  title!: string;

  @ApiProperty({ description: 'Semantic version', example: 'v1.0.0' })
  @IsString()
  version!: string;

  @ApiProperty({ description: 'Detailed description of the deliverables' })
  @IsString()
  description!: string;

  @ApiProperty({
    enum: [
      'FULL_MODERNIZATION_PACKAGE',
      'FRONTEND_COMPONENTS',
      'BACKEND_SERVICES',
      'VALIDATION_REPORT',
      'TECHNICAL_REPORT',
      'REVIEW_REPORT',
    ],
  })
  @IsEnum([
    'FULL_MODERNIZATION_PACKAGE',
    'FRONTEND_COMPONENTS',
    'BACKEND_SERVICES',
    'VALIDATION_REPORT',
    'TECHNICAL_REPORT',
    'REVIEW_REPORT',
  ])
  packageType!: DeliverablePackageType;

  @ApiProperty({ required: false, default: 0 })
  @IsOptional()
  @IsNumber()
  fileCount?: number;

  @ApiProperty({ required: false, default: '1.2 MB' })
  @IsOptional()
  @IsString()
  totalSizeFormatted?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  downloadUrl?: string;

  @ApiProperty({ required: false, enum: ['DRAFT', 'IN_REVIEW'] })
  @IsOptional()
  @IsEnum(['DRAFT', 'IN_REVIEW'])
  initialStatus?: 'DRAFT' | 'IN_REVIEW';
}
