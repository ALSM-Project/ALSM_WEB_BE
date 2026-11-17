import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { UsageHealthStatus } from '../domain/organization-usage.types';

export class ListOrganizationUsageQueryDto {
  @ApiPropertyOptional({ description: 'Search organization name, company, email, or Org ID' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ enum: ['ALSM_MANAGED', 'CUSTOMER_SELF_SERVICE'] })
  @IsOptional()
  serviceMode?: 'ALSM_MANAGED' | 'CUSTOMER_SELF_SERVICE';

  @ApiPropertyOptional({ enum: ['ACTIVE', 'TRIAL', 'EXPIRED', 'SUSPENDED', 'NO_CONTRACT'] })
  @IsOptional()
  contractStatus?: string;

  @ApiPropertyOptional({ enum: UsageHealthStatus })
  @IsEnum(UsageHealthStatus)
  @IsOptional()
  health?: UsageHealthStatus;

  @ApiPropertyOptional({ description: 'Filter by organization type (e.g. ENTERPRISE, PARTNER, CUSTOMER, SELF_SERVICE, or ORGANIZATIONS_ONLY)' })
  @IsString()
  @IsOptional()
  organizationType?: string;

  @ApiPropertyOptional({ description: 'Scope: ORGANIZATIONS_ONLY (excludes personal workspaces) or ALL', default: 'ORGANIZATIONS_ONLY' })
  @IsString()
  @IsOptional()
  scope?: string;

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

  @ApiPropertyOptional({ default: 'screenUsagePct' })
  @IsString()
  @IsOptional()
  sortBy?: string = 'screenUsagePct';

  @ApiPropertyOptional({ default: 'desc', enum: ['asc', 'desc'] })
  @IsString()
  @IsOptional()
  sortOrder?: 'asc' | 'desc' = 'desc';
}

export class QuotaAmendmentDto {
  @ApiProperty({
    enum: [
      'CAPACITY_UPGRADE',
      'ADDITIONAL_SCREENS',
      'STORAGE_EXPANSION',
      'CONTRACT_RENEWAL',
      'INCREASE',
      'DECREASE',
      'TEMPORARY_INCREASE',
    ],
    example: 'CAPACITY_UPGRADE',
  })
  @IsString()
  @IsNotEmpty()
  amendmentType!: string;

  @ApiPropertyOptional({ description: 'Delta screen capacity to add', example: 50 })
  @IsNumber()
  @IsOptional()
  screenCapacityDelta?: number;

  @ApiPropertyOptional({ description: 'Delta storage GB to add', example: 10 })
  @IsNumber()
  @IsOptional()
  storageGbDelta?: number;

  @ApiPropertyOptional({ description: 'Delta project capacity to add', example: 5 })
  @IsNumber()
  @IsOptional()
  projectCapacityDelta?: number;

  @ApiPropertyOptional({ description: 'Absolute target screen capacity', example: 100 })
  @IsNumber()
  @IsOptional()
  targetScreenCapacity?: number;

  @ApiPropertyOptional({ description: 'Absolute target project capacity', example: 20 })
  @IsNumber()
  @IsOptional()
  targetProjectCapacity?: number;

  @ApiPropertyOptional({ description: 'Absolute target storage in GB', example: 50 })
  @IsNumber()
  @IsOptional()
  targetStorageGb?: number;

  @ApiPropertyOptional({ description: 'Absolute target concurrent jobs', example: 5 })
  @IsNumber()
  @IsOptional()
  targetConcurrentJobs?: number;

  @ApiPropertyOptional({ description: 'Absolute target members count', example: 30 })
  @IsNumber()
  @IsOptional()
  targetMembers?: number;

  @ApiProperty({ description: 'Contract number or amendment identifier', example: 'CTR-2026-AMD-001' })
  @IsString()
  @IsNotEmpty()
  contractReference!: string;

  @ApiProperty({ description: 'Business justification or approval reference' })
  @IsString()
  @IsNotEmpty()
  justification!: string;

  @ApiPropertyOptional({ description: 'Effective date for quota change (ISO string)' })
  @IsString()
  @IsOptional()
  effectiveDate?: string;

  @ApiPropertyOptional({ description: 'Expiration date for temporary quota increase (ISO string)' })
  @IsString()
  @IsOptional()
  expirationDate?: string;
}

export class UpdateServiceStatusDto {
  @ApiProperty({ enum: ['SUSPEND', 'REACTIVATE'], example: 'SUSPEND' })
  @IsString()
  @IsNotEmpty()
  action!: 'SUSPEND' | 'REACTIVATE';

  @ApiProperty({ description: 'Reason for suspension or reactivation' })
  @IsString()
  @IsNotEmpty()
  reason!: string;
}
