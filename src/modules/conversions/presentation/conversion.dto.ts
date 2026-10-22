import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsMongoId,
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

/** Staff-triggered conversion of one partner screen/program (UC-47). The input source is
 * always taken from the screen on the server, so no inputReference is accepted here. */
export class StartPartnerConversionDto {
  @ApiProperty({ description: 'Screen or program to convert (or retry).' })
  @IsMongoId()
  screenId!: string;
  @ApiPropertyOptional({ enum: ConversionPriority, default: ConversionPriority.NORMAL })
  @IsOptional()
  @IsEnum(ConversionPriority)
  priority?: ConversionPriority;
}
export class StartPartnerBulkConversionDto {
  @ApiProperty({ type: [String], description: 'Screens or programs to convert ("Run All").' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsMongoId({ each: true })
  screenIds!: string[];
  @ApiPropertyOptional({ enum: ConversionPriority, default: ConversionPriority.NORMAL })
  @IsOptional()
  @IsEnum(ConversionPriority)
  priority?: ConversionPriority;
}
