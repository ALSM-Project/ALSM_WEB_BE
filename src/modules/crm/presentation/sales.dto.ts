import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  IsNumber,
  Matches,
  MaxLength,
  Max,
  Min,
  MinLength,
} from 'class-validator';
export class CreateSalesLeadDto {
  @ApiProperty() @IsMongoId() leadId!: string;
  @ApiProperty() @IsMongoId() assignmentId!: string;
  @ApiProperty() @IsMongoId() teamId!: string;
  @ApiProperty() @IsMongoId() salespersonId!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) title!: string;
  @ApiProperty() @Matches(/^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,199}$/) sourceReference!: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() @MaxLength(320) contactEmail?: string;
}
export class ReassignSalesLeadDto {
  @ApiProperty() @IsMongoId() assignmentId!: string;
  @ApiProperty() @IsMongoId() teamId!: string;
  @ApiProperty() @IsMongoId() salespersonId!: string;
  @ApiProperty() @IsInt() @Min(1) expectedRevision!: number;
}
export class ConvertSalesLeadDto {
  @ApiProperty() @IsMongoId() conversionId!: string;
  @ApiProperty() @IsMongoId() customerUserId!: string;
  @ApiProperty() @Matches(/^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,199}$/) reference!: string;
  @ApiProperty() @IsInt() @Min(1) expectedRevision!: number;
}
export class RecordSalesRevenueDto {
  @ApiProperty() @IsMongoId() paymentId!: string;
  @ApiProperty() @IsMongoId() teamId!: string;
  @ApiProperty() @IsMongoId() salespersonId!: string;
  @ApiProperty() @Matches(/^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,199}$/) evidenceReference!: string;
}

export class CreateContractDto {
  @ApiProperty({ minLength: 3, maxLength: 200 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title!: string;

  @ApiProperty({ minLength: 2, maxLength: 100 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  plan!: string;

  @ApiPropertyOptional({ description: 'Must identify an accepted quote on this lead when supplied' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  quoteId?: string;

  @ApiProperty({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER, description: 'Contract value in whole VND' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 0, allowNaN: false, allowInfinity: false })
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  annualValue!: number;

  @ApiPropertyOptional({ description: 'Contract effective date as YYYY-MM-DD; defaults to today' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  effectiveDate?: string;
}
