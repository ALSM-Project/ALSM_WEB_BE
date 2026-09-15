import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ErrorLogSeverity, ErrorLogStatus } from '../domain/error-log.types';

export class ListErrorLogsQueryDto {
  @ApiPropertyOptional({
    enum: ErrorLogSeverity,
    description: 'Filter by severity level',
  })
  @IsOptional()
  @IsEnum(ErrorLogSeverity)
  severity?: ErrorLogSeverity;

  @ApiPropertyOptional({
    enum: ErrorLogStatus,
    description: 'Filter by status (UNRESOLVED, RESOLVED, IGNORED)',
  })
  @IsOptional()
  @IsEnum(ErrorLogStatus)
  status?: ErrorLogStatus;

  @ApiPropertyOptional({ description: 'Search by screen name or error code' })
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;

  @ApiPropertyOptional({ description: 'Page number (1-indexed)', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: 'Items per page (max 100)', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class SuggestedPatchResponseDto {
  @ApiProperty() offendingLine!: string;
  @ApiProperty() suggestedLine!: string;
  @ApiProperty() reason!: string;
}

export class ErrorLogResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() projectId!: string;
  @ApiProperty() organizationId!: string;
  @ApiProperty() screenName!: string;
  @ApiProperty() errorCode!: string;
  @ApiProperty({ enum: ErrorLogSeverity }) severity!: ErrorLogSeverity;
  @ApiProperty({ enum: ErrorLogStatus }) status!: ErrorLogStatus;
  @ApiProperty() lineNumber!: number;
  @ApiProperty() offendingCode!: string;
  @ApiProperty({ type: SuggestedPatchResponseDto }) suggestedPatch!: SuggestedPatchResponseDto;
  @ApiProperty() createdAt!: Date;
  @ApiPropertyOptional() resolvedAt?: Date;
  @ApiPropertyOptional() resolvedBy?: string;
}

export class ErrorLogSummaryResponseDto {
  @ApiProperty() total!: number;
  @ApiProperty() fatal!: number;
  @ApiProperty() error!: number;
  @ApiProperty() warning!: number;
  @ApiProperty() resolved!: number;
  @ApiProperty() unresolved!: number;
  @ApiProperty() ignored!: number;
}
