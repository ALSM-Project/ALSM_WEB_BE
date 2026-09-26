import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsString, MaxLength, ValidateNested } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class MethodMappingEntryDto {
  @ApiProperty({ description: 'Generated .java file this member belongs to.' })
  @IsString()
  @MaxLength(500)
  relativePath!: string;

  @ApiProperty({ enum: ['CLASS', 'METHOD'] })
  @IsIn(['CLASS', 'METHOD'])
  kind!: 'CLASS' | 'METHOD';

  @ApiProperty({ description: 'The name tool2java actually generated.' })
  @IsString()
  @MaxLength(200)
  originalName!: string;

  @ApiProperty({ description: 'The user-chosen replacement name (must be a valid Java identifier).' })
  @IsString()
  @MaxLength(200)
  targetName!: string;
}

export class SaveMethodMappingDto {
  @ApiProperty({ type: [MethodMappingEntryDto] })
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => MethodMappingEntryDto)
  entries!: MethodMappingEntryDto[];
}
