import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
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
