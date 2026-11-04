import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { SUPPORT_PATCH_DATA_TYPES, SupportPatchDataType } from '../domain/support-patch.types';

export class SupportPatchRuleDto {
  @ApiProperty({ example: 'CUST_BAL_AMT' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  sourceField!: string;

  @ApiProperty({ example: 'currentBalance' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  targetProperty!: string;

  @ApiProperty({ enum: SUPPORT_PATCH_DATA_TYPES, example: 'BigDecimal' })
  @IsIn(SUPPORT_PATCH_DATA_TYPES)
  dataType!: SupportPatchDataType;

  @ApiProperty({ example: 'parseDecimal(2)', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  transformRule?: string;
}

export class ApplySupportPatchDto {
  @ApiProperty({ type: [SupportPatchRuleDto] })
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => SupportPatchRuleDto)
  rules!: SupportPatchRuleDto[];

  @ApiProperty({ example: 'Changed the balance type from string to decimal' })
  @IsString()
  @IsNotEmpty({ message: 'A support note is required' })
  @MaxLength(1000)
  note!: string;
}
