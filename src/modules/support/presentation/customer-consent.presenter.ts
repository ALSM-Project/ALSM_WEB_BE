import type { GetCustomerConsentStatusService } from '../application/get-customer-consent-status.service';
import type { RequestCustomerConsentService } from '../application/request-customer-consent.service';
import type {
  CustomerConsentResponseDto,
  CustomerConsentStatusResponseDto,
} from './customer-consent.dto';

/** Explicit allowlist: no proposal, person, provenance, policy, source or history output. */
export class CustomerConsentPresenter {
  static write(
    result: Awaited<ReturnType<RequestCustomerConsentService['execute']>>,
  ): CustomerConsentResponseDto {
    const p = result.consent;
    return {
      consentId: p.consentId,
      organizationId: p.organizationId,
      ticketId: p.ticketId,
      episodeId: p.episodeId,
      state: p.state,
      revision: p.revision,
      operationalAccess: false,
    };
  }
  static status(
    result: Awaited<ReturnType<GetCustomerConsentStatusService['execute']>>,
  ): CustomerConsentStatusResponseDto {
    return {
      consentId: result.consentId,
      organizationId: result.organizationId,
      ticketId: result.ticketId,
      episodeId: result.episodeId,
      state: result.state,
      revision: result.revision,
      operationalAccess: false,
      ticketCompatibility: result.ticketCompatibility,
    };
  }
}
