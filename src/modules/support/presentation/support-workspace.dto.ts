import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { SupportContextParamsDto } from './support-context.dto';
import { DiagnosticView } from '../../../shared/application/diagnostic-read.port';
export class SupportWorkspacePageDto {
  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 25 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(25)
  limit = 10;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[a-f0-9]{24}$/) afterId?: string;
}
export class SupportWorkspaceProjectDto extends SupportContextParamsDto {
  @ApiProperty() @Matches(/^[a-f0-9]{24}$/) projectId!: string;
}
export class SupportWorkspaceResourceDto extends SupportWorkspaceProjectDto {
  @ApiProperty({ enum: ['screens', 'programs', 'findings', 'conversion-logs', 'error-logs'] })
  @IsIn(['screens', 'programs', 'findings', 'conversion-logs', 'error-logs'])
  resource!: 'screens' | 'programs' | 'findings' | 'conversion-logs' | 'error-logs';
}
export class SupportWorkspaceDetailDto extends SupportWorkspaceResourceDto {
  @ApiProperty() @Matches(/^[a-f0-9]{24}$/) resourceId!: string;
}
export class SupportWorkspacePageResponseDto {
  @ApiProperty({ format: 'uuid' }) operationId!: string;
  @ApiProperty({
    type: [Object],
    description:
      'Explicit bounded diagnostic projections only; no source, payloads or storage references',
  })
  items!: DiagnosticView[];
  @ApiProperty({ type: String, nullable: true }) nextAfterId!: string | null;
}
export class SupportWorkspaceDetailResponseDto {
  @ApiProperty({ format: 'uuid' }) operationId!: string;
  @ApiProperty({
    type: Object,
    description: 'Safe diagnostic projection, with fields specified in the Support README',
  })
  item!: DiagnosticView;
}
