import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class SignatoryConfigDto {
  @IsString()
  @IsNotEmpty({ message: 'Signatory name is required' })
  signerName!: string;

  @IsString()
  @IsNotEmpty({ message: 'Signatory title is required' })
  signerTitle!: string;

  @IsEmail({}, { message: 'A valid signatory email address is required' })
  signerEmail!: string;

  @IsString()
  @IsOptional()
  digitalCertificateProvider?: string;

  @IsString()
  @IsOptional()
  certificateSerialNumber?: string;

  @IsBoolean()
  @IsOptional()
  autoCounterSignEnabled?: boolean;

  @IsString()
  @IsOptional()
  signatureImageUrl?: string;

  @IsString()
  @IsOptional()
  companySealUrl?: string;

  @IsString()
  @IsOptional()
  signatureType?: string;

  @IsString()
  @IsOptional()
  stampPosition?: string;

  @IsString()
  @IsOptional()
  signingMethod?: string;

  @IsString()
  @IsOptional()
  certificateStatus?: string;

  @IsString()
  @IsOptional()
  certificateValidUntil?: string;
}

export class UpdateProviderCompanyProfileDto {
  @IsString()
  @IsNotEmpty({ message: 'Legal company name is required' })
  legalName!: string;

  @IsString()
  @IsNotEmpty({ message: 'Tax identification number is required' })
  taxId!: string;

  @IsString()
  @IsNotEmpty({ message: 'Registered headquarters address is required' })
  registeredAddress!: string;

  @IsString()
  @IsOptional()
  businessRegistrationNumber?: string;

  @IsString()
  @IsNotEmpty({ message: 'Legal representative name is required' })
  representativeName!: string;

  @IsString()
  @IsNotEmpty({ message: 'Representative title is required' })
  representativeTitle!: string;

  @IsEmail({}, { message: 'A valid contact email is required' })
  contactEmail!: string;

  @IsString()
  @IsOptional()
  contactPhone?: string;

  @IsString()
  @IsNotEmpty({ message: 'Bank name is required' })
  bankName!: string;

  @IsString()
  @IsNotEmpty({ message: 'Bank account number is required' })
  bankAccountNumber!: string;

  @IsString()
  @IsNotEmpty({ message: 'Bank account holder name is required' })
  bankAccountHolder!: string;

  @IsString()
  @IsOptional()
  companyLogo?: string;

  @ValidateNested()
  @Type(() => SignatoryConfigDto)
  signatoryConfig!: SignatoryConfigDto;

  @IsString()
  @IsOptional()
  changeReason?: string;
}
