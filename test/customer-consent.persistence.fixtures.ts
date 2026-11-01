import { randomUUID } from 'node:crypto';
import { CustomerConsentEntity } from '../src/modules/support/domain/customer-consent.entity';
import type { CustomerConsentAudit } from '../src/modules/support/domain/customer-consent.repository';
import {
  consentIds,
  consentNow,
  consentSourceFixture,
  pendingConsentFixture,
} from './customer-consent.fixtures';

export function persistedConsentFixture(
  input: {
    consentId?: string;
    ticketId?: string;
    organizationId?: string;
    episodeId?: string;
    sourceId?: string;
  } = {},
) {
  const p = pendingConsentFixture().toProps();
  const source = consentSourceFixture(input.sourceId ?? randomUUID());
  return CustomerConsentEntity.fromPersistence({
    ...p,
    consentId: input.consentId ?? randomUUID(),
    ticketId: input.ticketId ?? p.ticketId,
    organizationId: input.organizationId ?? p.organizationId,
    episodeId: input.episodeId ?? p.episodeId,
    customerAuthority: {
      ...p.customerAuthority,
      organizationId: input.organizationId ?? p.organizationId,
    },
    requestSource: source,
    history: [{ ...p.history[0], source }],
  });
}
export function negativeConsentFixture(
  pending: CustomerConsentEntity,
  action: 'DECLINE' | 'INVALIDATE' = 'DECLINE',
  actorUserId = consentIds.actor,
  sourceId: string = randomUUID(),
) {
  return pending.transition({
    action,
    actorUserId,
    source: consentSourceFixture(sourceId),
    now: new Date(consentNow.getTime() + 1000),
    reason: action === 'INVALIDATE' ? 'TICKET_CLOSED' : null,
  });
}
export function consentAuditFixture(
  consent: CustomerConsentEntity,
  expectedRevision: number | null = null,
): CustomerConsentAudit {
  const p = consent.toProps(),
    event = p.history[p.history.length - 1];
  return {
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
      sourceAuthorityId: event.source.authorityId,
      sourceEventId: event.source.evidenceId,
    },
  };
}
