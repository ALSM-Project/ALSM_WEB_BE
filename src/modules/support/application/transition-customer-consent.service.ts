import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { CustomerConsentEntity } from '../domain/customer-consent.entity';
import {
  CUSTOMER_CONSENT_REPOSITORY,
  CustomerConsentRepository,
} from '../domain/customer-consent.repository';
import { CustomerConsentAction, CustomerConsentError } from '../domain/customer-consent.types';
import {
  consentDataCopy,
  consentRevision,
  consentSource,
  consentUuid,
  freezeConsentData,
} from '../domain/customer-consent.validation';
import type { AuthorityRevisionReference } from '../domain/ticket-consent-boundary.contracts';
import {
  captureConsentTicket,
  consentConflict,
  consentInput,
  CustomerConsentContextService,
  CustomerConsentTicketCommand,
  ticketConsentCompatibility,
} from './customer-consent-context.service';
import { writeCustomerConsent } from './customer-consent-write';

export interface TransitionCustomerConsentCommand extends CustomerConsentTicketCommand {
  readonly consentId: string;
  readonly expectedRevision: number;
  readonly action: Exclude<CustomerConsentAction, 'REQUEST'>;
  readonly source: AuthorityRevisionReference;
}
@Injectable()
export class TransitionCustomerConsentService {
  constructor(
    private readonly context: CustomerConsentContextService,
    @Inject(CUSTOMER_CONSENT_REPOSITORY) private readonly consents: CustomerConsentRepository,
  ) {}
  async execute(input: TransitionCustomerConsentCommand) {
    const { action } = input;
    if (action !== 'DECLINE' && action !== 'INVALIDATE')
      throw new ServiceUnavailableException({
        code:
          action === 'GRANT'
            ? 'CUSTOMER_CONSENT_VERIFICATION_UNAVAILABLE'
            : 'CUSTOMER_CONSENT_OPERATION_UNSUPPORTED',
        message: 'This Customer Consent operation has no approved implementation',
      });
    const { command, consentId, expectedRevision, source } = consentInput(() => {
      const command = captureConsentTicket(input),
        consentId = input.consentId,
        expectedRevision = input.expectedRevision,
        source = consentDataCopy(input.source);
      consentUuid(consentId);
      consentRevision(expectedRevision);
      consentSource(source);
      return freezeConsentData({ command, consentId, expectedRevision, source });
    });
    const ticket = await this.context.ticket(command, action === 'INVALIDATE');
    const compatibility = ticketConsentCompatibility(ticket.toProps(), command.episodeId);
    const reason =
      action === 'INVALIDATE' && compatibility !== 'CURRENT_EPISODE_OPEN' ? compatibility : null;
    if (action === 'INVALIDATE' && reason === null)
      consentConflict('CUSTOMER_CONSENT_INVALID_TRANSITION');
    const authorization = await this.context.authorize({
      action,
      actorUserId: command.actorUserId,
      ticket: {
        ticketId: command.ticketId,
        organizationId: command.organizationId,
        episodeId: command.episodeId,
      },
      ticketRevision: command.expectedTicketRevision,
      consentId,
      expectedConsentRevision: expectedRevision,
      scope: command.scope,
      proposal: null,
      source,
      invalidationReason: reason,
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
    let consent;
    try {
      consent = CustomerConsentEntity.fromPersistence(stored.toProps());
    } catch {
      throw new ServiceUnavailableException({
        code: 'CUSTOMER_CONSENT_SNAPSHOT_INVALID',
        message: 'Stored Customer Consent is invalid',
      });
    }
    const p = consent.toProps();
    this.context.assertBinding(p, command, consentId);
    if (p.revision !== expectedRevision) consentConflict();
    if (
      action === 'DECLINE' &&
      (p.grantor.accountId !== authorization.actor.accountId ||
        p.grantor.personId !== authorization.actor.personId)
    )
      throw new ForbiddenException({
        code: 'CUSTOMER_CONSENT_ACCESS_DENIED',
        message: 'The original verified grantor must decline this pending request',
      });
    await this.context.ticket(command, action === 'INVALIDATE');
    let next;
    try {
      next = consent.transition({
        action,
        actorUserId: command.actorUserId,
        source,
        now: new Date(),
        reason,
      });
    } catch (error) {
      if (!(error instanceof CustomerConsentError)) throw error;
      consentConflict(error.code);
    }
    return writeCustomerConsent(next, expectedRevision, (audit) =>
      this.consents.save(next, expectedRevision, audit),
    );
  }
}
