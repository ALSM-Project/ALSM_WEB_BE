import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class UpdateOrganizationLegalProfileDto {
  @IsString()
  @IsNotEmpty({ message: 'Tax ID is required' })
  taxId!: string;

  @IsString()
  @IsNotEmpty({ message: 'Legal company name is required' })
  legalCompanyName!: string;

  @IsString()
  @IsNotEmpty({ message: 'Registered headquarters address is required' })
  registeredAddress!: string;

  @IsString()
  @IsOptional()
  businessRegistrationNumber?: string;

  @IsString()
  @IsNotEmpty({ message: 'Legal representative name is required' })
  legalRepresentative!: string;

  @IsString()
  @IsNotEmpty({ message: 'Representative title / position is required' })
  representativeTitle!: string;

  @IsEmail({}, { message: 'A valid contractual notice email is required' })
  contactEmail!: string;

  @IsString()
  @IsOptional()
  contactPhone?: string;

  @IsString()
  @IsOptional()
  companyStatus?: string;

  @IsString()
  @IsOptional()
  dataSource?: string;

  @IsOptional()
  lookupTimestamp?: Date;

  @IsEnum(['UNVERIFIED', 'TAX_VERIFIED', 'REPRESENTATIVE_VERIFIED', 'REJECTED'])
  @IsOptional()
  verificationStatus?: 'UNVERIFIED' | 'TAX_VERIFIED' | 'REPRESENTATIVE_VERIFIED' | 'REJECTED';

  @IsString()
  @IsOptional()
  notes?: string;
}
