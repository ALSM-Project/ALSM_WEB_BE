import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ITaxLookupProvider,
  TaxLookupResult,
  TaxLookupStatus,
} from '../domain/tax-lookup-provider.port';

const VIETNAM_TAX_ID_REGEX = /^[0-9]{10}(-[0-9]{3})?$/;

@Injectable()
export class TaxIdLookupAdapter implements ITaxLookupProvider {
  private readonly logger = new Logger(TaxIdLookupAdapter.name);

  constructor(private readonly config: ConfigService) {}

  getStatus(): TaxLookupStatus {
    const apiUrl = this.getProviderUrl();
    const isConfigured = Boolean(apiUrl && apiUrl.trim().length > 0);

    return {
      isConfigured,
      providerName: 'National Business Registry Adapter (VietQR / General Department of Taxation)',
      supportedFormats: ['10-digit Enterprise Tax ID', '13-digit Branch Tax ID (XXXX-XXX)'],
      message: isConfigured
        ? 'Verified Tax ID lookup service is configured and operational.'
        : 'Tax lookup provider API endpoint is not configured in environment variables. Manual entry is supported.',
    };
  }

  async lookup(rawTaxId: string): Promise<TaxLookupResult> {
    if (!rawTaxId || typeof rawTaxId !== 'string') {
      throw new BadRequestException({
        code: 'INVALID_TAX_ID_FORMAT',
        message: 'Tax Identification Number is required.',
      });
    }

    const normalizedTaxId = rawTaxId.trim().replace(/\s+/g, '');

    if (!VIETNAM_TAX_ID_REGEX.test(normalizedTaxId)) {
      throw new BadRequestException({
        code: 'INVALID_TAX_ID_FORMAT',
        message:
          'Invalid Tax ID format. Standard enterprise tax code must consist of 10 digits or 10 digits with a 3-digit branch suffix (e.g. 0109876543 or 0109876543-001).',
      });
    }

    const providerUrl = this.getProviderUrl();
    if (!providerUrl) {
      throw new ServiceUnavailableException({
        code: 'TAX_LOOKUP_PROVIDER_UNCONFIGURED',
        message:
          'Verified Tax ID lookup provider is not configured on this instance. Please enter company legal information manually.',
      });
    }

    const endpoint = providerUrl.endsWith('/')
      ? `${providerUrl}${normalizedTaxId}`
      : `${providerUrl}/${normalizedTaxId}`;

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': 'ALSM-Enterprise-Platform/1.0',
    };

    const apiKey = this.config.get<string>('TAX_LOOKUP_API_KEY');
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);

      const response = await fetch(endpoint, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (response.status === 404) {
        throw new NotFoundException({
          code: 'TAX_ID_NOT_FOUND',
          message: `No active business registration found for Tax ID: ${normalizedTaxId}. Please verify the number or complete entry manually.`,
        });
      }

      if (!response.ok) {
        this.logger.warn(`Tax ID lookup provider returned HTTP ${response.status}`);
        throw new ServiceUnavailableException({
          code: 'TAX_LOOKUP_PROVIDER_ERROR',
          message: 'Company registry provider returned an error. Please enter details manually.',
        });
      }

      const payload = await response.json();
      const data = payload?.data || payload;

      const legalName = data?.name || data?.legalName || data?.companyName || data?.title;
      const address = data?.address || data?.registeredAddress || data?.headquarters;

      if (!legalName || !address) {
        throw new NotFoundException({
          code: 'TAX_ID_NOT_FOUND',
          message: `Incomplete registration record for Tax ID: ${normalizedTaxId}. Please complete company details manually.`,
        });
      }

      return {
        taxId: normalizedTaxId,
        legalCompanyName: legalName.trim(),
        registeredAddress: address.trim(),
        businessRegistrationNumber: data?.id || data?.code || normalizedTaxId,
        companyStatus: data?.status || 'ACTIVE',
        dataSource: 'VERIFIED_BUSINESS_REGISTRY_API',
        lookupTimestamp: new Date(),
        verificationStatus: 'TAX_VERIFIED',
        identityVerified: false,
        disclaimer:
          'Tax ID lookup confirms enterprise registration with the business registry only. It does not verify the identity or signing authority of the person submitting this form.',
      };
    } catch (err: any) {
      if (err instanceof NotFoundException || err instanceof BadRequestException || err instanceof ServiceUnavailableException) {
        throw err;
      }

      if (err?.name === 'AbortError') {
        throw new ServiceUnavailableException({
          code: 'TAX_LOOKUP_TIMEOUT',
          message: 'Tax ID registry lookup timed out. Please enter company details manually.',
        });
      }

      this.logger.error(`Failed to query tax lookup provider: ${err?.message || err}`);
      throw new ServiceUnavailableException({
        code: 'TAX_LOOKUP_UNAVAILABLE',
        message: 'Could not reach company data registry. Please enter company details manually.',
      });
    }
  }

  private getProviderUrl(): string | undefined {
    return (
      this.config.get<string>('TAX_LOOKUP_API_URL') ||
      this.config.get<string>('VIETQR_BUSINESS_API_URL')
    );
  }
}
