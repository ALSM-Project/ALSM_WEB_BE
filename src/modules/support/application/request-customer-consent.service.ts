import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { CustomerConsentEntity } from '../domain/customer-consent.entity';
import {
  CUSTOMER_CONSENT_REPOSITORY,
  CustomerConsentRepository,
} from '../domain/customer-consent.repository';
import { CustomerConsentError, CustomerConsentProposal } from '../domain/customer-consent.types';
import {
  consentDataCopy,
  consentProposal,
  consentSource,
  freezeConsentData,
} from '../domain/customer-consent.validation';
import type { AuthorityRevisionReference } from '../domain/ticket-consent-boundary.contracts';
import {
  captureConsentTicket,
  consentInput,
  CustomerConsentContextService,
  CustomerConsentTicketCommand,
} from './customer-consent-context.service';
import { writeCustomerConsent } from './customer-consent-write';

export interface RequestCustomerConsentCommand extends CustomerConsentTicketCommand {
  readonly proposal: CustomerConsentProposal;
  readonly source: AuthorityRevisionReference;
}
@Injectable()
export class RequestCustomerConsentService {
  constructor(
    private readonly context: CustomerConsentContextService,
    @Inject(CUSTOMER_CONSENT_REPOSITORY) private readonly consents: CustomerConsentRepository,
  ) {}
  async execute(input: RequestCustomerConsentCommand) {
    const { command, proposal, source } = consentInput(() => {
      const command = captureConsentTicket(input);
      const proposal = consentDataCopy(input.proposal),
        source = consentDataCopy(input.source);
      consentProposal(proposal);
      consentSource(source);
      // Both scope inputs must mean exactly the same proposed operation/projection.
      if (!isDeepStrictEqual(proposal.scope, command.scope))
        throw new CustomerConsentError('CUSTOMER_CONSENT_CONTEXT_MISMATCH');
      return freezeConsentData({ command, proposal, source });
    });
    await this.context.ticket(command, false);
    const consentId = randomUUID();
    const authorization = await this.context.authorize({
      action: 'REQUEST',
      actorUserId: command.actorUserId,
      ticket: {
        ticketId: command.ticketId,
        organizationId: command.organizationId,
        episodeId: command.episodeId,
      },
      ticketRevision: command.expectedTicketRevision,
      consentId,
      expectedConsentRevision: null,
      scope: command.scope,
      proposal,
      source,
      invalidationReason: null,
    });
    // A Ticket that closes/reopens while identity verification waits cannot create
    // a new compatible request. This reread is not a cross-store revocation fence.
    const ticket = await this.context.ticket(command, false);
    const consent = consentInput(() =>
      CustomerConsentEntity.request({
        consentId,
        ticket,
        episodeId: command.episodeId,
        proposal,
        grantor: authorization.actor,
        customerAuthority: authorization.customerAuthority,
        actorUserId: command.actorUserId,
        source,
        now: new Date(),
      }),
    );
    return writeCustomerConsent(consent, null, (audit) => this.consents.create(consent, audit));
  }
}
