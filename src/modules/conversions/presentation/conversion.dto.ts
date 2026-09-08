import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ConversionPriority } from '../domain/conversion-job.types';
export class CreateConversionJobDto {
  @ApiPropertyOptional({ description: 'Legacy screen this job converts, if job is screen-scoped.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  screenId?: string;
  @ApiPropertyOptional({ enum: ConversionPriority, default: ConversionPriority.NORMAL })
  @IsOptional()
  @IsEnum(ConversionPriority)
  priority?: ConversionPriority;
  @ApiPropertyOptional({ description: 'Future storage reference, never raw source content.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  inputReference?: string;
}
export class BulkCreateConversionJobDto {
  @ApiPropertyOptional({ type: [String], description: 'Legacy screen IDs to convert.' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  screenIds!: string[];
  @ApiPropertyOptional({ enum: ConversionPriority, default: ConversionPriority.NORMAL })
  @IsOptional()
  @IsEnum(ConversionPriority)
  priority?: ConversionPriority;
  @ApiPropertyOptional({ description: 'Future storage reference, never raw source content.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  inputReference?: string;
}
