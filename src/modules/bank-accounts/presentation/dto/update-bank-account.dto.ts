import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateBankAccountDto {
  @ApiPropertyOptional({ description: 'Bank Name', example: 'Vietcombank' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  bankName?: string;

  @ApiPropertyOptional({ description: 'Bank Code', example: 'VCB' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  bankCode?: string;

  @ApiPropertyOptional({ description: 'Napas/VietQR Bank Identification Number (BIN 6 digits)', example: '970436' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  bin?: string;

  @ApiPropertyOptional({ description: 'Account Holder Full Legal Name', example: 'ALSM SOFTWARE JOINT STOCK COMPANY' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  accountHolderName?: string;

  @ApiPropertyOptional({ description: 'Full Bank Account Number (if updating)', example: '0123456789' })
  @IsOptional()
  @IsString()
  @MinLength(4)
  @MaxLength(50)
  accountNumber?: string;

  @ApiPropertyOptional({ description: 'Currency Code', example: 'VND' })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @ApiPropertyOptional({ description: 'Country Code (ISO 3166-1 alpha-2)', example: 'VN' })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  country?: string;

  @ApiPropertyOptional({ description: 'Bank Branch Name', example: 'Thang Long Branch' })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  branchName?: string;

  @ApiPropertyOptional({ description: 'SWIFT / BIC Code', example: 'BFTVVNVX' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  swiftBic?: string;

  @ApiPropertyOptional({ description: 'Bank Physical Address' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  bankAddress?: string;

  @ApiPropertyOptional({ description: 'Internal Description' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ description: 'Status', enum: ['active', 'inactive'] })
  @IsOptional()
  @IsEnum(['active', 'inactive'])
  status?: 'active' | 'inactive';

  @ApiPropertyOptional({ description: 'Default status for currency' })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
