import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateBankAccountDto {
  @ApiProperty({ description: 'Bank Name', example: 'Vietcombank' })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  bankName!: string;

  @ApiPropertyOptional({ description: 'Bank Code (e.g. VCB, MB, TCB)', example: 'VCB' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  bankCode?: string;

  @ApiPropertyOptional({ description: 'Napas/VietQR Bank Identification Number (BIN 6 digits)', example: '970436' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  bin?: string;

  @ApiProperty({ description: 'Account Holder Full Legal Name', example: 'ALSM SOFTWARE JOINT STOCK COMPANY' })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(150)
  accountHolderName!: string;

  @ApiProperty({ description: 'Full Bank Account Number', example: '0123456789' })
  @IsString()
  @IsNotEmpty()
  @MinLength(4)
  @MaxLength(50)
  accountNumber!: string;

  @ApiProperty({ description: 'Currency Code (ISO 4217)', example: 'VND', default: 'VND' })
  @IsString()
  @IsNotEmpty()
  @Length(3, 3)
  currency!: string;

  @ApiPropertyOptional({ description: 'Country Code (ISO 3166-1 alpha-2)', example: 'VN', default: 'VN' })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  country?: string;

  @ApiPropertyOptional({ description: 'Bank Branch Name', example: 'Thang Long Branch - Hanoi' })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  branchName?: string;

  @ApiPropertyOptional({ description: 'SWIFT / BIC Code', example: 'BFTVVNVX' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  swiftBic?: string;

  @ApiPropertyOptional({ description: 'Bank Physical Address', example: '198 Tran Quang Khai, Hoan Kiem, Hanoi' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  bankAddress?: string;

  @ApiPropertyOptional({ description: 'Internal Administrative Description / Purpose', example: 'Main receiving account for domestic conversion contracts' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ description: 'Status of the bank account', enum: ['active', 'inactive'], default: 'active' })
  @IsOptional()
  @IsEnum(['active', 'inactive'])
  status?: 'active' | 'inactive';

  @ApiPropertyOptional({ description: 'Set as Default Receiving Account for this currency', default: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
