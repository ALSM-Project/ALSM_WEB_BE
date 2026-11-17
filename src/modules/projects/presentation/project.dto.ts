import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ConversionType, ManagedProjectStage, ProjectStatus } from '../domain/project.types';

export class CreateProjectDto {
  @ApiProperty({ enum: ConversionType })
  @IsEnum(ConversionType)
  conversionType!: ConversionType;

  @ApiProperty({ example: 'Claims screen modernization' })
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ enum: ['SELF_SERVICE', 'MANAGED'] })
  @IsOptional()
  @IsEnum(['SELF_SERVICE', 'MANAGED'])
  serviceType?: 'SELF_SERVICE' | 'MANAGED';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contractNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contractId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  businessRequirements?: string;
}

export class AssignTeamLeadDto {
  @ApiProperty({ description: 'User ID of the ALSM internal Team Lead' })
  @IsString()
  @IsNotEmpty()
  teamLeadId!: string;

  @ApiPropertyOptional({ description: 'Technical briefing / notes from Admin' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class UpdateProjectStageDto {
  @ApiProperty({ enum: ManagedProjectStage, description: 'Target stage of canonical 9 stages' })
  @IsEnum(ManagedProjectStage)
  stage!: ManagedProjectStage;

  @ApiPropertyOptional({ description: 'Progression notes or summary' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class AdminReviewProjectDto {
  @ApiProperty({ enum: ['APPROVE', 'REQUEST_INFO', 'REJECT'] })
  @IsIn(['APPROVE', 'REQUEST_INFO', 'REJECT'])
  action!: 'APPROVE' | 'REQUEST_INFO' | 'REJECT';

  @ApiPropertyOptional({ description: 'Feedback or explanation notes' })
  @IsOptional()
  @IsString()
  @MaxLength(1500)
  notes?: string;
}

export class CustomerAcceptanceDto {
  @ApiPropertyOptional({ description: 'Acceptance notes or formal sign-off comments' })
  @IsOptional()
  @IsString()
  @MaxLength(1500)
  notes?: string;
}

export class AssignProjectStaffDto {
  @ApiProperty({ description: 'User id of the Conversion Staff member' })
  @IsString()
  @MinLength(1)
  staffId!: string;

  @ApiPropertyOptional({ description: 'Technical briefing for the engineer' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @ApiPropertyOptional({ description: 'Transfer or reassignment reason (UC-84)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;

  @ApiPropertyOptional({ description: 'Specific project role for this staff member' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  role?: string;

  @ApiPropertyOptional({ description: 'Responsibility or task scope' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  responsibility?: string;

  @ApiPropertyOptional({ description: 'Priority level (e.g. NORMAL, HIGH, URGENT)' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  priority?: string;
}

export class AllocateStaffBatchDto {
  @ApiProperty({ description: 'List of staff user IDs to allocate', type: [String] })
  staffIds!: string[];

  @ApiPropertyOptional() @IsOptional() @IsString() role?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() responsibility?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() note?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() priority?: string;
}

export class RemoveProjectStaffDto {
  @ApiPropertyOptional({ description: 'Reason for removing staff from project' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class UpdateProjectDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(150) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @ApiPropertyOptional({ enum: ProjectStatus })
  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;
  @ApiPropertyOptional({ enum: ManagedProjectStage })
  @IsOptional()
  @IsEnum(ManagedProjectStage)
  currentStage?: ManagedProjectStage;
  @ApiPropertyOptional() @IsOptional() @IsString() adminReviewNotes?: string;
}
