import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsString,
  Min,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LegacyFieldDescriptorDto {
  @ApiProperty({ description: 'Legacy source field name, e.g. USER-ID-INPUT.' })
  @IsString()
  @MaxLength(200)
  name!: string;

  @ApiProperty({ description: 'Legacy field data type, e.g. Alphanumeric.' })
  @IsString()
  @MaxLength(100)
  type!: string;

  @ApiProperty({ description: 'Legacy field length in characters.' })
  @IsInt()
  @Min(0)
  length!: number;

  @ApiProperty({ description: 'Legacy field position, e.g. "R10, C15".' })
  @IsString()
  @MaxLength(100)
  position!: string;
}

export class FieldComponentMappingDto {
  @ApiProperty({ description: 'Target UI component type, e.g. Text Field.' })
  @IsString()
  @MaxLength(100)
  componentType!: string;

  @ApiProperty({ description: 'Label text shown for the generated field.' })
  @IsString()
  @MaxLength(200)
  labelText!: string;

  @ApiProperty()
  @IsBoolean()
  isRequired!: boolean;

  @ApiProperty()
  @IsInt()
  @Min(0)
  minLength!: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  maxLength!: number;

  @ApiProperty({ description: 'Optional validation regex applied to the field.' })
  @IsString()
  @MaxLength(500)
  regexPattern!: string;
}

export class FieldMappingEntryDto {
  @ApiProperty({ type: LegacyFieldDescriptorDto })
  @ValidateNested()
  @Type(() => LegacyFieldDescriptorDto)
  legacyField!: LegacyFieldDescriptorDto;

  @ApiProperty({ type: FieldComponentMappingDto })
  @ValidateNested()
  @Type(() => FieldComponentMappingDto)
  componentMapping!: FieldComponentMappingDto;
}

export class SaveFieldMappingDto {
  @ApiProperty({ type: [FieldMappingEntryDto] })
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => FieldMappingEntryDto)
  mappings!: FieldMappingEntryDto[];
}
