import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ContractTemplateSectionDto {
  @ApiProperty({ maxLength: 120 })
  @IsString() @MinLength(1) @MaxLength(120)
  heading!: string;

  @ApiProperty({ maxLength: 20000, description: 'Plain text only; legal content must be supplied and approved by the authorized Legal reviewer.' })
  @IsString() @MinLength(1) @MaxLength(20000)
  body!: string;
}

export class CreateContractTemplateVersionDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Omit for a new template; include to create a new immutable version of an existing template.' })
  @IsOptional() @IsUUID()
  templateId?: string;

  @ApiProperty({ minLength: 3, maxLength: 160 })
  @IsString() @MinLength(3) @MaxLength(160)
  title!: string;

  @ApiProperty({ enum: ['vi', 'en', 'vi-en'] })
  @IsIn(['vi', 'en', 'vi-en'])
  locale!: 'vi' | 'en' | 'vi-en';

  @ApiProperty({ type: [ContractTemplateSectionDto], minItems: 1, maxItems: 40 })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(40)
  @ValidateNested({ each: true }) @Type(() => ContractTemplateSectionDto)
  sections!: ContractTemplateSectionDto[];
}

export class RejectContractTemplateVersionDto {
  @ApiProperty({ minLength: 5, maxLength: 1000 })
  @IsString() @MinLength(5) @MaxLength(1000)
  reason!: string;
}
