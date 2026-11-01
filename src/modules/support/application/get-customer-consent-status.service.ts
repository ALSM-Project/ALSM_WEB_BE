import { Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { CustomerConsentEntity } from '../domain/customer-consent.entity';
import {
  CUSTOMER_CONSENT_REPOSITORY,
  CustomerConsentRepository,
} from '../domain/customer-consent.repository';
import { consentUuid } from '../domain/customer-consent.validation';
import {
  captureConsentTicket,
  consentInput,
  CustomerConsentContextService,
  CustomerConsentTicketCommand,
  ticketConsentCompatibility,
} from './customer-consent-context.service';

@Injectable()
export class GetCustomerConsentStatusService {
  constructor(
    private readonly context: CustomerConsentContextService,
    @Inject(CUSTOMER_CONSENT_REPOSITORY) private readonly consents: CustomerConsentRepository,
  ) {}
  async execute(input: CustomerConsentTicketCommand & { readonly consentId: string }) {
    const { command, consentId } = consentInput(() => {
      const command = captureConsentTicket(input),
        consentId = input.consentId;
      consentUuid(consentId);
      return { command, consentId };
    });
    await this.context.ticket(command, true);
    await this.context.authorize({
      action: 'STATUS',
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
      proposal: null,
      source: null,
      invalidationReason: null,
    });
    const stored = await this.consents.findById(
      consentId,
      command.organizationId,
      command.ticketId,
    );
    if (!stored)
      throw new NotFoundException({
        code: 'CUSTOMER_CONSENT_NOT_FOUND',
        message: 'Customer Consent is unavailable in this scope',
      });
    let p;
    try {
      p = CustomerConsentEntity.fromPersistence(stored.toProps()).toProps();
    } catch {
      throw new ServiceUnavailableException({
        code: 'CUSTOMER_CONSENT_SNAPSHOT_INVALID',
        message: 'Stored Customer Consent is invalid',
      });
    }
    this.context.assertBinding(p, command, consentId);
    const ticket = await this.context.ticket(command, true);
    return {
      consentId: p.consentId,
      ticketId: p.ticketId,
      organizationId: p.organizationId,
      episodeId: p.episodeId,
      state: p.state,
      revision: p.revision,
      ticketCompatibility: ticketConsentCompatibility(ticket.toProps(), p.episodeId),
      operationalAccess: false as const,
    };
  }
}
