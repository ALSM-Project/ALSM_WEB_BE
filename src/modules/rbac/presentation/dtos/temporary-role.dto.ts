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
