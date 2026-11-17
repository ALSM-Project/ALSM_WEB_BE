export interface TaxLookupResult {
  taxId: string;
  legalCompanyName: string;
  registeredAddress: string;
  businessRegistrationNumber?: string;
  companyStatus?: string;
  dataSource: string;
  lookupTimestamp: Date;
  verificationStatus: 'TAX_VERIFIED';
  identityVerified: boolean;
  disclaimer: string;
}

export interface TaxLookupStatus {
  isConfigured: boolean;
  providerName: string;
  supportedFormats: string[];
  message?: string;
}

export const TAX_LOOKUP_PROVIDER = 'TAX_LOOKUP_PROVIDER';

export interface ITaxLookupProvider {
  getStatus(): TaxLookupStatus;
  lookup(taxId: string): Promise<TaxLookupResult>;
}
