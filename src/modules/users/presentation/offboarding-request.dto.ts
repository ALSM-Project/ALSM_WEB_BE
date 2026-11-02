import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { OffboardingRequestStatus } from '../domain/offboarding-request.types';

export class ProjectTransferItemDto {
  @ApiProperty({ description: 'ID of the project being reassigned' })
  @IsString()
  @IsNotEmpty()
  projectId!: string;

  @ApiPropertyOptional({ description: 'Display name of the project' })
  @IsString()
  @IsOptional()
  projectName?: string;

  @ApiProperty({ description: 'Target successor staff ID for this project' })
  @IsString()
  @IsNotEmpty()
  targetStaffId!: string;

  @ApiPropertyOptional({ description: 'Display name of the target successor staff' })
  @IsString()
  @IsOptional()
  targetStaffName?: string;

  @ApiPropertyOptional({ description: 'Specific transfer reason or handover note' })
  @IsString()
  @IsOptional()
  reason?: string;
}

export class CreateOffboardingRequestDto {
  @ApiProperty({ description: 'User ID of the staff member to offboard' })
  @IsString()
  @IsNotEmpty()
  targetUserId!: string;

  @ApiProperty({ description: 'Reason for requesting offboarding' })
  @IsString()
  @IsNotEmpty()
  reason!: string;

  @ApiPropertyOptional({ description: 'Optional additional context or handover notes' })
  @IsString()
  @IsOptional()
  note?: string;

  @ApiPropertyOptional({
    description: 'Proposed default successor user ID to receive transferable resources',
  })
  @IsString()
  @IsOptional()
  transferToUserId?: string;

  @ApiPropertyOptional({
    type: [ProjectTransferItemDto],
    description: 'Explicit per-project transfers if reassigned to different team members',
  })
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ProjectTransferItemDto)
  projectTransfers?: ProjectTransferItemDto[];

  @ApiPropertyOptional({ description: 'Category type of offboarding (Resignation, etc.)' })
  @IsString()
  @IsOptional()
  offboardingType?: string;

  @ApiPropertyOptional({ description: 'Expected effective date of offboarding' })
  @IsOptional()
  effectiveDate?: string;

  @ApiPropertyOptional({ description: 'Target deadline for handover completion' })
  @IsOptional()
  handoverDeadline?: string;

  @ApiPropertyOptional({ description: 'Summary of pending tasks and responsibilities' })
  @IsString()
  @IsOptional()
  pendingTasks?: string;

  @ApiPropertyOptional({ description: 'Documentation and knowledge transfer status' })
  @IsString()
  @IsOptional()
  documentationStatus?: string;

  @ApiPropertyOptional({ description: 'Department name' })
  @IsString()
  @IsOptional()
  department?: string;

  @ApiPropertyOptional({ description: 'Direct manager name' })
  @IsString()
  @IsOptional()
  directManager?: string;

  @ApiPropertyOptional({ description: 'Save as draft' })
  @IsBoolean()
  @IsOptional()
  isDraft?: boolean;
}

export class ApproveOffboardingRequestDto {
  @ApiPropertyOptional({
    description: 'Override successor user ID to receive transferable resources',
  })
  @IsString()
  @IsOptional()
  transferToUserId?: string;

  @ApiPropertyOptional({
    type: [ProjectTransferItemDto],
    description: 'Override per-project transfer assignments upon approval',
  })
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ProjectTransferItemDto)
  projectTransfers?: ProjectTransferItemDto[];

  @ApiPropertyOptional({ description: 'Approval note or execution comments' })
  @IsString()
  @IsOptional()
  note?: string;
}

export class RejectOffboardingRequestDto {
  @ApiProperty({ description: 'Mandatory reason for rejecting the offboarding request' })
  @IsString()
  @IsNotEmpty()
  rejectionReason!: string;

  @ApiPropertyOptional({ description: 'Optional feedback note for the requester' })
  @IsString()
  @IsOptional()
  note?: string;
}

export class CancelOffboardingRequestDto {
  @ApiPropertyOptional({ description: 'Optional cancellation reason' })
  @IsString()
  @IsOptional()
  reason?: string;
}

export class ListOffboardingRequestsQueryDto {
  @ApiPropertyOptional({
    description: 'Filter requests by status',
  })
  @IsOptional()
  status?: OffboardingRequestStatus;

  @ApiPropertyOptional({ description: 'Filter by team ID' })
  @IsString()
  @IsOptional()
  teamId?: string;

  @ApiPropertyOptional({ description: 'Filter by target staff user ID' })
  @IsString()
  @IsOptional()
  targetUserId?: string;
}
