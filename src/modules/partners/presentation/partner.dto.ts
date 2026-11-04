import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { PARTNER_NAME_MAX_LENGTH, PartnerStatus } from '../domain/partner.types';

export class CreatePartnerDto {
  @ApiProperty({ example: 'Pacific Banking Systems Ltd.', maxLength: PARTNER_NAME_MAX_LENGTH })
  @IsNotEmpty()
  @IsString()
  @MaxLength(PARTNER_NAME_MAX_LENGTH)
  name!: string;

  @ApiProperty({ example: 'jreynolds@pacificbanking.com' })
  @IsNotEmpty()
  @IsEmail()
  @MaxLength(254)
  contactEmail!: string;

  @ApiProperty({ example: 'Jonathan Reynolds' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(200)
  contactName!: string;

  @ApiProperty({ example: 'pacificbanking.com' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(253)
  primaryDomain!: string;

  @ApiPropertyOptional({ example: 'Dedicated Modernization' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  engagementType?: string;

  @ApiPropertyOptional({ example: 'Sarah Jenkins (Sr. Conversion Specialist)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  assignedStaffName?: string;
}

export class ListPartnersQueryDto {
  @ApiPropertyOptional({ enum: PartnerStatus })
  @IsOptional()
  @IsEnum(PartnerStatus)
  status?: PartnerStatus;

  @ApiPropertyOptional({ description: 'Matches name, contact email or domain' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}
