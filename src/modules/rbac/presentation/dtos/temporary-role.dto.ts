import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class GrantTemporaryRoleDto {
  @ApiProperty({ description: 'Target user ID to grant temporary role to' })
  @IsString()
  @IsNotEmpty()
  targetUserId!: string;

  @ApiProperty({ description: 'Role identifier to grant temporarily' })
  @IsString()
  @IsNotEmpty()
  roleId!: string;

  @ApiProperty({ description: 'Duration in hours (1-24)', minimum: 1, maximum: 24, default: 8 })
  @IsInt()
  @Min(1)
  @Max(24)
  durationHours!: number;

  @ApiProperty({ description: 'Business justification (min 10 characters)' })
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(1000)
  reason!: string;

  @ApiPropertyOptional({ description: 'Optional project identifier for scoped elevation' })
  @IsOptional()
  @IsString()
  projectId?: string;

  @ApiPropertyOptional({ description: 'Scope type: ALL_CONTEXTS | SPECIFIC_PROJECT | SPECIFIC_ORGANIZATION | NONE' })
  @IsOptional()
  @IsString()
  scopeType?: string;

  @ApiPropertyOptional({ description: 'Identifier of targeted scope (project ID, org ID)' })
  @IsOptional()
  @IsString()
  scopeId?: string;
}

export class RequestTemporaryRoleDto {
  @ApiProperty({ description: 'Requested temporary role identifier' })
  @IsString()
  @IsNotEmpty()
  roleId!: string;

  @ApiProperty({ description: 'Requested duration in hours (1-24)', minimum: 1, maximum: 24, default: 4 })
  @IsInt()
  @Min(1)
  @Max(24)
  durationHours!: number;

  @ApiProperty({ description: 'Business justification explaining need for elevation (min 10 characters)' })
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(1000)
  reason!: string;

  @ApiPropertyOptional({ description: 'Target project or workflow requiring elevation' })
  @IsOptional()
  @IsString()
  projectId?: string;
}

export class ReviewTemporaryRoleRequestDto {
  @ApiProperty({ description: 'Whether the request is approved (true) or rejected (false)' })
  @IsBoolean()
  approved!: boolean;

  @ApiPropertyOptional({ description: 'Reason for rejection (mandatory if rejected) or reviewer note' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;

  @ApiPropertyOptional({ description: 'Adjusted duration in hours (1-24) upon approval' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24)
  durationHours?: number;
}

export class RevokeTemporaryRoleDto {
  @ApiProperty({ description: 'Reason for early revocation of temporary role' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}

export class EligibleStaffQueryDto {
  @ApiPropertyOptional({ description: 'Search query for name, email, or employee ID' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Filter by department' })
  @IsOptional()
  @IsString()
  department?: string;

  @ApiPropertyOptional({ description: 'Filter by current baseline role' })
  @IsOptional()
  @IsString()
  currentRole?: string;

  @ApiPropertyOptional({ description: 'Filter by account status: ALL | ACTIVE | LOCKED | DEACTIVATED' })
  @IsOptional()
  @IsString()
  accountStatus?: string;

  @ApiPropertyOptional({ description: 'Filter by eligibility: ALL | ELIGIBLE | INELIGIBLE' })
  @IsOptional()
  @IsString()
  eligibility?: string;

  @ApiPropertyOptional({ description: 'Page number', default: 1 })
  @IsOptional()
  page?: number | string;

  @ApiPropertyOptional({ description: 'Items per page', default: 10 })
  @IsOptional()
  limit?: number | string;

  @ApiPropertyOptional({ description: 'Sort field' })
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({ description: 'Sort order: asc | desc' })
  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc';
}
