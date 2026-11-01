import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { EngagementTypeLimitsDto } from './create-engagement-type.dto';

export class UpdateEngagementTypeDto {
  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toUpperCase() : value)
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{1,49}$/)
  code?: string;

  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000_000_000)
  price?: number;

  @IsOptional()
  @ValidateNested()
  @IsDefined()
  @Type(() => EngagementTypeLimitsDto)
  trialLimits?: EngagementTypeLimitsDto;

  @IsOptional()
  @ValidateNested()
  @IsDefined()
  @Type(() => EngagementTypeLimitsDto)
  usageLimits?: EngagementTypeLimitsDto;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @Transform(({ value }) => Array.isArray(value) ? value.map((item: unknown) => typeof item === 'string' ? item.trim() : item) : value)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(120, { each: true })
  features?: string[];

  @IsOptional()
  @IsBoolean()
  includesCobolConversion?: boolean;

  @IsOptional()
  @IsIn(['COMMUNITY', 'STANDARD', 'STANDARD_ENTERPRISE', 'PREMIER'])
  supportTier?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8760)
  slaHours?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
