import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ProjectTransferItemDto {
  @ApiProperty({ description: 'ID of the project to reassign' })
  @IsString()
  @IsNotEmpty()
  projectId!: string;

  @ApiProperty({ description: 'ID of the new assigned staff member' })
  @IsString()
  @IsNotEmpty()
  targetStaffId!: string;

  @ApiPropertyOptional({ description: 'Specific note or justification for this transfer' })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class ExecuteUserOffboardingDto {
  @ApiPropertyOptional({
    description: 'Successor user ID to receive all transferable projects and tasks',
  })
  @IsOptional()
  @IsString()
  transferToUserId?: string;

  @ApiPropertyOptional({
    description: 'Optional granular project transfers if different projects go to different staff',
    type: [ProjectTransferItemDto],
  })
  @IsOptional()
  @IsArray()
  projectTransfers?: ProjectTransferItemDto[];

  @ApiPropertyOptional({
    description: 'Mandatory business justification reason for offboarding',
    example: 'Contract completion / department transfer',
  })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional({
    description: 'Explicit confirmation flag before execution',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  confirmDeactivation?: boolean;
}
