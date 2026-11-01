import { ServiceUnavailableException } from '@nestjs/common';
import type { CustomerConsentEntity } from '../domain/customer-consent.entity';
import type {
  CustomerConsentAudit,
  CustomerConsentWriteOutcome,
} from '../domain/customer-consent.repository';
import { consentConflict } from './customer-consent-context.service';

/** The supplied future adapter owns state+audit confirmation; no separate audit write. */
export async function writeCustomerConsent(
  consent: CustomerConsentEntity,
  expectedRevision: number | null,
  write: (audit: CustomerConsentAudit) => Promise<CustomerConsentWriteOutcome>,
) {
  const p = consent.toProps();
  const last = p.history[p.history.length - 1];
  let outcome: CustomerConsentWriteOutcome;
  try {
    outcome = await write({
      actorUserId: p.updatedByUserId,
      organizationId: p.organizationId,
      action: `CUSTOMER_CONSENT_${p.state === 'PENDING_VERIFICATION' ? 'REQUESTED' : p.state}`,
      resourceType: 'CUSTOMER_CONSENT',
      resourceId: p.consentId,
      metadata: {
        ticketId: p.ticketId,
        episodeId: p.episodeId,
        revision: String(p.revision),
        ...(expectedRevision === null ? {} : { expectedRevision: String(expectedRevision) }),
        state: p.state,
        sourceAuthorityId: last.source.authorityId,
        sourceEventId: last.source.evidenceId,
      },
    });
  } catch {
    return unconfirmed();
  }
  if (outcome === 'CONFLICT') consentConflict();
  if (outcome !== 'CONFIRMED') return unconfirmed();
  return { outcome: 'CONFIRMED' as const, consent: p, operationalAccess: false as const };

  function unconfirmed(): never {
    throw new ServiceUnavailableException({
      code: 'CUSTOMER_CONSENT_OUTCOME_UNCONFIRMED',
      message: 'Reconcile the original consent identity before retrying',
      details: [
        {
          consentId: p.consentId,
          ticketId: p.ticketId,
          organizationId: p.organizationId,
          episodeId: p.episodeId,
          revision: p.revision,
          expectedRevision,
          mutationCommitted: 'unknown',
          retrySafe: false,
        },
      ],
    });
  }
}
