import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ConversionType, ProjectStatus } from '../domain/project.types';
export class CreateProjectDto {
  @ApiProperty({ enum: ConversionType }) @IsEnum(ConversionType) conversionType!: ConversionType;
  @ApiProperty({ example: 'Claims screen modernization' })
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string;
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
}
export class UpdateProjectDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(150) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @ApiPropertyOptional({ enum: ProjectStatus })
  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;
}
