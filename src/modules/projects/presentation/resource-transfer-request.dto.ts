import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateTransferRequestDto {
  @ApiProperty({ description: 'Target Project ID' })
  @IsString()
  @IsNotEmpty()
  projectId!: string;

  @ApiProperty({ description: 'Target Staff User ID (Conversion Staff)' })
  @IsString()
  @IsNotEmpty()
  targetStaffId!: string;

  @ApiPropertyOptional({ description: 'Reassignment / transfer reason', default: 'Workload Balancing' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;

  @ApiPropertyOptional({ description: 'Technical briefing or transfer notes' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class ApproveTransferRequestDto {
  @ApiPropertyOptional({ description: 'Reviewer approval remarks' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class RejectTransferRequestDto {
  @ApiProperty({ description: 'Reason for rejection' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
