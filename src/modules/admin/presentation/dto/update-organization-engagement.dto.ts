import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class OrganizationEngagementLimitsDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  maxProjects?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  maxConversionsPerMonth?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.1)
  @Max(1_000_000)
  maxStorageGb?: number;

  @IsOptional()
  @IsBoolean()
  aiValidationEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  trialScreens?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  trialPrograms?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.1)
  @Max(1_000_000)
  trialStorageGb?: number;
}

export class UpdateOrganizationEngagementDto {
  @IsOptional()
  @IsString()
  @IsIn(['ACTIVE', 'SUSPENDED', 'TRIAL'])
  status?: 'ACTIVE' | 'SUSPENDED' | 'TRIAL';

  @IsOptional()
  @IsString()
  @MaxLength(100)
  engagementType?: string;

  @IsOptional()
  @IsDateString()
  trialExpiresAt?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => OrganizationEngagementLimitsDto)
  limits?: OrganizationEngagementLimitsDto;
}
