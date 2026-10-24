import { IsString, IsNotEmpty, IsOptional, IsNumber, IsEnum, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export type ServiceMode = 'SELF_SERVICE_CONVERSION' | 'SELF_SERVICE' | 'WE_CONVERT_FOR_YOU' | 'HYBRID';
export type ContractType = 
  | 'SELF_SERVICE_SUBSCRIPTION'
  | 'MANAGED_CONVERSION_SOW'
  | 'ENTERPRISE_HYBRID_MSA'
  | 'NON_DISCLOSURE_AGREEMENT'
  | 'ORDER_FORM'
  | 'CONTRACT_AMENDMENT';

export class CustomerDetailsDto {
  @IsString()
  @IsNotEmpty()
  companyName!: string;

  @IsString()
  @IsNotEmpty()
  taxId!: string;

  @IsString()
  @IsOptional()
  businessAddress?: string;

  @IsString()
  @IsNotEmpty()
  representativeName!: string;

  @IsString()
  @IsNotEmpty()
  representativeTitle!: string;

  @IsString()
  @IsOptional()
  contactEmail?: string;

  @IsString()
  @IsOptional()
  contactPhone?: string;

  @IsString()
  @IsOptional()
  powerOfAttorneyRef?: string;
}

export class ServiceScopeDto {
  @IsNumber()
  screensQuota!: number;

  @IsNumber()
  programsQuota!: number;

  @IsNumber()
  storageGb!: number;

  @IsString()
  @IsOptional()
  targetTechnology?: string;

  @IsString()
  @IsOptional()
  sourceCodeType?: string;

  @IsString()
  @IsOptional()
  supportTier?: string;

  @IsString()
  @IsOptional()
  slaCommitment?: string;

  @IsArray()
  @IsOptional()
  deliverables?: string[];
}

export class CommercialTermsDto {
  @IsNumber()
  totalValue!: number;

  @IsString()
  @IsOptional()
  currency: string = 'VND';

  @IsNumber()
  @IsOptional()
  discountPercent: number = 0;

  @IsNumber()
  @IsOptional()
  vatRate: number = 10;

  @IsNumber()
  @IsOptional()
  subtotal?: number;

  @IsNumber()
  @IsOptional()
  discountAmount?: number;

  @IsNumber()
  @IsOptional()
  vatAmount?: number;

  @IsString()
  @IsOptional()
  paymentStructure?: 'ONE_TIME' | 'MILESTONE_BASED' | 'MONTHLY_SUBSCRIPTION';

  @IsString()
  @IsOptional()
  bankAccountInfo?: string;

  @IsString()
  @IsOptional()
  paymentTermsDays?: string;
}

export class ContractClauseDto {
  @IsString()
  title!: string;

  @IsString()
  category!: string;

  @IsString()
  description!: string;

  @IsString()
  @IsOptional()
  legalReference?: string;
}

export class ContractMilestoneDto {
  @IsString()
  title!: string;

  @IsString()
  description!: string;

  @IsString()
  targetDate!: string;

  @IsNumber()
  paymentPercentage!: number;

  @IsArray()
  deliverables!: string[];

  @IsString()
  @IsOptional()
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'APPROVED' = 'PENDING';
}

export class CreateEnterpriseContractDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @IsNotEmpty()
  serviceMode!: ServiceMode;

  @IsString()
  @IsNotEmpty()
  contractType!: ContractType;

  @IsString()
  @IsNotEmpty()
  organizationId!: string;

  @IsString()
  @IsOptional()
  leadId?: string;

  @IsString()
  @IsNotEmpty()
  planTier!: string;

  @IsString()
  @IsNotEmpty()
  effectiveDate!: string;

  @IsString()
  @IsNotEmpty()
  endDate!: string;

  @ValidateNested()
  @Type(() => CustomerDetailsDto)
  customer!: CustomerDetailsDto;

  @ValidateNested()
  @Type(() => ServiceScopeDto)
  scope!: ServiceScopeDto;

  @ValidateNested()
  @Type(() => CommercialTermsDto)
  commercialTerms!: CommercialTermsDto;

  @IsArray()
  @IsOptional()
  clauses?: ContractClauseDto[];

  @IsArray()
  @IsOptional()
  milestones?: ContractMilestoneDto[];

  @IsString()
  @IsOptional()
  specialConditions?: string;

  @IsString()
  @IsOptional()
  requestId?: string;
}

export class ReviewContractDto {
  @IsEnum(['APPROVE', 'REQUEST_CHANGES', 'REJECT'])
  action!: 'APPROVE' | 'REQUEST_CHANGES' | 'REJECT';

  @IsString()
  @IsOptional()
  reason?: string;
}

export class CustomerDecisionDto {
  @IsEnum(['ACCEPT', 'REQUEST_CHANGES', 'DECLINE'])
  action!: 'ACCEPT' | 'REQUEST_CHANGES' | 'DECLINE';

  @IsString()
  @IsOptional()
  comments?: string;
}

export class SignContractDto {
  @IsEnum(['ALSM_PROVIDER', 'CUSTOMER'])
  signerRole!: 'ALSM_PROVIDER' | 'CUSTOMER';

  @IsString()
  @IsNotEmpty()
  signerName!: string;

  @IsString()
  @IsNotEmpty()
  signerTitle!: string;

  @IsString()
  @IsNotEmpty()
  signerEmail!: string;

  @IsString()
  @IsOptional()
  authMethod?: string;

  @IsString()
  @IsOptional()
  signatureImageUrl?: string;
}

export class AmendContractDto {
  @IsString()
  @IsNotEmpty()
  amendmentTitle!: string;

  @IsString()
  @IsNotEmpty()
  effectiveDate!: string;

  @IsString()
  @IsNotEmpty()
  changesSummary!: string;

  @IsNumber()
  @IsOptional()
  additionalValue?: number;

  @IsNumber()
  @IsOptional()
  additionalScreensQuota?: number;
}

export class TerminateContractDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;

  @IsString()
  @IsNotEmpty()
  effectiveTerminationDate!: string;
}

export class SubmitContractPaymentDto {
  @IsString()
  @IsOptional()
  transactionRef?: string;

  @IsString()
  @IsOptional()
  note?: string;

  @IsNumber()
  @IsOptional()
  paidAmount?: number;
}

export class ConfirmContractPaymentDto {
  @IsString()
  @IsOptional()
  note?: string;
}

export class GenerateContractFromPackageDto {
  @IsEnum(['SELF_SERVICE', 'WE_CONVERT_FOR_YOU', 'HYBRID'])
  serviceMode!: ServiceMode;

  @IsString()
  @IsNotEmpty()
  packageTier!: 'STARTER' | 'GROWTH' | 'ENTERPRISE' | 'CUSTOM';

  @IsString()
  @IsOptional()
  organizationName?: string;

  @IsString()
  @IsOptional()
  taxId?: string;

  @IsString()
  @IsOptional()
  businessAddress?: string;

  @IsString()
  @IsOptional()
  representativeName?: string;

  @IsString()
  @IsOptional()
  representativeTitle?: string;

  @IsString()
  @IsOptional()
  contactEmail?: string;

  @IsNumber()
  @IsOptional()
  customScreensQuota?: number;
}

