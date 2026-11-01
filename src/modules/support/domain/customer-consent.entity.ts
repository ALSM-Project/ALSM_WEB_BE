import { isDeepStrictEqual } from 'node:util';
import type {
  AuthorityRevisionReference,
  CustomerConsentReference,
  PersonAccountEvidenceReference,
} from './ticket-consent-boundary.contracts';
import type { SupportTicketEntity } from './support-ticket.entity';
import {
  CustomerConsentAction,
  CustomerConsentError,
  CustomerConsentInvalidationReason,
  CustomerConsentProposal,
  CustomerConsentProps,
  customerConsentNextState,
} from './customer-consent.types';
import {
  consentAccountId,
  consentDataCopy,
  consentEvidence,
  consentIdentifier,
  consentPerson,
  consentProposal,
  consentRevision,
  consentShape,
  consentSource,
  consentUuid,
  freezeConsentData,
  invalidConsent,
} from './customer-consent.validation';

/** Immutable negative/pending snapshots only. Reconstitution never verifies evidence. */
export class CustomerConsentEntity {
  private constructor(private readonly props: CustomerConsentProps) {}

  static request(input: {
    consentId: string;
    ticket: SupportTicketEntity;
    episodeId: string;
    proposal: CustomerConsentProposal;
    grantor: PersonAccountEvidenceReference;
    customerAuthority: CustomerConsentReference['customerAuthority'];
    actorUserId: string;
    source: AuthorityRevisionReference;
    now: Date;
  }): CustomerConsentEntity {
    const ticket = input.ticket.toProps();
    if (
      ticket.status !== 'OPEN' ||
      ticket.episodeId !== input.episodeId ||
      ticket.purposeId !== input.proposal.scope.purposeId
    )
      throw new CustomerConsentError('CUSTOMER_CONSENT_CONTEXT_MISMATCH');
    return this.fromPersistence({
      ...input.proposal,
      schemaVersion: 1,
      consentId: input.consentId,
      ticketId: ticket.ticketId,
      organizationId: ticket.organizationId,
      episodeId: ticket.episodeId,
      purposeId: ticket.purposeId,
      grantor: input.grantor,
      customerAuthority: input.customerAuthority,
      requestSource: input.source,
      state: customerConsentNextState('NOT_REQUESTED', 'REQUEST'),
      revision: 0,
      createdByUserId: input.actorUserId,
      updatedByUserId: input.actorUserId,
      createdAt: input.now,
      updatedAt: input.now,
      history: [
        {
          revision: 0,
          from: 'NOT_REQUESTED',
          to: 'PENDING_VERIFICATION',
          actorUserId: input.actorUserId,
          source: input.source,
          at: input.now,
          reason: null,
        },
      ],
    });
  }

  static fromPersistence(input: CustomerConsentProps): CustomerConsentEntity {
    const p = consentDataCopy(input);
    consentShape(p, [
      'schemaVersion',
      'consentId',
      'ticketId',
      'organizationId',
      'episodeId',
      'purposeId',
      'scope',
      'beneficiary',
      'coverage',
      'policy',
      'grantor',
      'customerAuthority',
      'requestSource',
      'state',
      'revision',
      'createdByUserId',
      'updatedByUserId',
      'createdAt',
      'updatedAt',
      'history',
    ]);
    if (p.schemaVersion !== 1) invalidConsent();
    [p.consentId, p.ticketId, p.episodeId].forEach(consentUuid);
    [p.organizationId, p.createdByUserId, p.updatedByUserId].forEach(consentAccountId);
    consentIdentifier(p.purposeId);
    consentRevision(p.revision);
    consentProposal({
      scope: p.scope,
      beneficiary: p.beneficiary,
      coverage: p.coverage,
      policy: p.policy,
    });
    consentPerson(p.grantor);
    consentShape(p.customerAuthority, ['kind', 'organizationId', 'evidence']);
    consentEvidence(p.customerAuthority.evidence);
    consentSource(p.requestSource);
    if (
      p.customerAuthority.kind !== 'ORGANIZATION_OWNER' ||
      p.customerAuthority.organizationId !== p.organizationId ||
      p.grantor.accountId !== p.createdByUserId ||
      p.scope.purposeId !== p.purposeId
    )
      invalidConsent();
    // Even a structurally perfect CURRENT/verified claim cannot restore a grant.
    if (p.state === 'VERIFIED_GRANTED')
      throw new CustomerConsentError('CUSTOMER_CONSENT_VERIFICATION_UNAVAILABLE');
    if (!['PENDING_VERIFICATION', 'DECLINED', 'INVALIDATED'].includes(p.state))
      throw new CustomerConsentError('CUSTOMER_CONSENT_OPERATION_UNSUPPORTED');
    if (
      !(p.createdAt instanceof Date) ||
      !(p.updatedAt instanceof Date) ||
      !Array.isArray(p.history) ||
      p.history.length !== p.revision + 1 ||
      p.history.length > 2
    )
      invalidConsent();
    let previous = 'NOT_REQUESTED' as CustomerConsentProps['state'];
    let previousTime = p.createdAt.getTime();
    const events = new Set<string>();
    for (const [index, event] of p.history.entries()) {
      consentShape(event, ['revision', 'from', 'to', 'actorUserId', 'source', 'at', 'reason']);
      consentAccountId(event.actorUserId);
      consentSource(event.source);
      if (
        !(event.at instanceof Date) ||
        event.revision !== index ||
        event.from !== previous ||
        event.at.getTime() < previousTime
      )
        invalidConsent();
      const key = JSON.stringify([event.source.authorityId, event.source.evidenceId]);
      if (events.has(key)) throw new CustomerConsentError('CUSTOMER_CONSENT_EVENT_REUSED');
      events.add(key);
      const action =
        index === 0
          ? 'REQUEST'
          : event.to === 'DECLINED'
            ? 'DECLINE'
            : event.to === 'INVALIDATED'
              ? 'INVALIDATE'
              : 'GRANT';
      if (customerConsentNextState(previous, action) !== event.to) invalidConsent();
      if (
        index === 0 &&
        (event.actorUserId !== p.createdByUserId ||
          event.at.getTime() !== p.createdAt.getTime() ||
          !isDeepStrictEqual(event.source, p.requestSource))
      )
        invalidConsent();
      if (event.to === 'DECLINED' && event.actorUserId !== p.grantor.accountId) invalidConsent();
      if (
        event.to === 'INVALIDATED'
          ? !['TICKET_CLOSED', 'TICKET_CANCELLED', 'EPISODE_CHANGED'].includes(event.reason ?? '')
          : event.reason !== null
      )
        invalidConsent();
      previous = event.to;
      previousTime = event.at.getTime();
    }
    const last = p.history[p.history.length - 1];
    if (
      !last ||
      previous !== p.state ||
      previousTime !== p.updatedAt.getTime() ||
      last.actorUserId !== p.updatedByUserId
    )
      invalidConsent();
    return new CustomerConsentEntity(freezeConsentData(p));
  }

  transition(input: {
    action: CustomerConsentAction;
    actorUserId: string;
    source: AuthorityRevisionReference;
    now: Date;
    reason: CustomerConsentInvalidationReason | null;
  }): CustomerConsentEntity {
    const state = customerConsentNextState(this.props.state, input.action);
    return CustomerConsentEntity.fromPersistence({
      ...this.toProps(),
      state,
      revision: this.props.revision + 1,
      updatedAt: input.now,
      updatedByUserId: input.actorUserId,
      history: [
        ...this.props.history,
        {
          revision: this.props.revision + 1,
          from: this.props.state,
          to: state,
          actorUserId: input.actorUserId,
          source: input.source,
          at: input.now,
          reason: input.reason,
        },
      ],
    });
  }

  toProps(): CustomerConsentProps {
    return consentDataCopy(this.props);
  }
}
