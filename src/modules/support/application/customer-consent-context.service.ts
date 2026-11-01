import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';
import {
  SUPPORT_TICKET_REPOSITORY,
  SupportTicketRepository,
} from '../domain/support-ticket.repository';
import type { SupportTicketProps } from '../domain/support-ticket.types';
import { CustomerConsentError } from '../domain/customer-consent.types';
import type { CustomerConsentProps } from '../domain/customer-consent.types';
import {
  consentAccountId,
  consentDataCopy,
  consentEvidence,
  consentPerson,
  consentRevision,
  consentScope,
  consentShape,
  consentUuid,
  freezeConsentData,
} from '../domain/customer-consent.validation';
import type { TicketConsentScope } from '../domain/ticket-consent-boundary.contracts';
import {
  SUPPORT_TICKET_ACCESS,
  SupportTicketAccessPort,
  requireSupportTicketAccess,
} from './support-ticket-access.port';
import {
  CUSTOMER_CONSENT_AUTHORITY,
  CustomerConsentActorAuthorization,
  CustomerConsentAuthorityInput,
  CustomerConsentAuthorityPort,
} from './customer-consent-authority.port';

export interface CustomerConsentTicketCommand {
  readonly actorUserId: string;
  readonly organizationId: string;
  readonly ticketId: string;
  readonly episodeId: string;
  readonly expectedTicketRevision: number;
  readonly scope: TicketConsentScope;
}

export function consentInput<T>(read: () => T): T {
  try {
    return read();
  } catch (error) {
    if (!(error instanceof CustomerConsentError)) throw error;
    throw new BadRequestException({
      code: error.code,
      message: 'Invalid Customer Consent request',
    });
  }
}
export function captureConsentTicket(
  input: CustomerConsentTicketCommand,
): CustomerConsentTicketCommand {
  const { actorUserId, organizationId, ticketId, episodeId, expectedTicketRevision } = input;
  const scope = consentDataCopy(input.scope);
  [actorUserId, organizationId].forEach(consentAccountId);
  [ticketId, episodeId].forEach(consentUuid);
  consentRevision(expectedTicketRevision);
  consentScope(scope);
  return freezeConsentData({
    actorUserId,
    organizationId,
    ticketId,
    episodeId,
    expectedTicketRevision,
    scope,
  });
}
export function consentConflict(code = 'CUSTOMER_CONSENT_CONFLICT'): never {
  throw new ConflictException({
    code,
    message: 'Customer Consent context changed or transition is unavailable',
  });
}
export function ticketConsentCompatibility(ticket: SupportTicketProps, episodeId: string) {
  if (ticket.episodeId !== episodeId) return 'EPISODE_CHANGED' as const;
  if (ticket.status === 'CLOSED') return 'TICKET_CLOSED' as const;
  if (ticket.status === 'CANCELLED') return 'TICKET_CANCELLED' as const;
  return 'CURRENT_EPISODE_OPEN' as const;
}

@Injectable()
export class CustomerConsentContextService {
  constructor(
    @Inject(SUPPORT_TICKET_REPOSITORY) private readonly tickets: SupportTicketRepository,
    @Optional() @Inject(SUPPORT_TICKET_ACCESS) private readonly owners?: SupportTicketAccessPort,
    @Optional()
    @Inject(CUSTOMER_CONSENT_AUTHORITY)
    private readonly authority?: CustomerConsentAuthorityPort,
  ) {}

  async ticket(input: CustomerConsentTicketCommand, historical: boolean) {
    // Never retain a caller-owned command over either authority or storage wait.
    const command = consentInput(() => captureConsentTicket(input));
    if (!this.authority) this.denied();
    await requireSupportTicketAccess(this.owners, {
      actorUserId: command.actorUserId,
      organizationId: command.organizationId,
      ticketId: command.ticketId,
      action: 'READ',
    });
    const ticket = await this.tickets.findById(command.ticketId, command.organizationId);
    const p = ticket?.toProps();
    if (!p || p.ticketId !== command.ticketId || p.organizationId !== command.organizationId)
      throw new NotFoundException({
        code: 'SUPPORT_TICKET_NOT_FOUND',
        message: 'Support Ticket is unavailable',
      });
    if (
      p.revision !== command.expectedTicketRevision ||
      p.purposeId !== command.scope.purposeId ||
      !p.episodes.some((episode) => episode.episodeId === command.episodeId)
    )
      consentConflict('CUSTOMER_CONSENT_CONTEXT_MISMATCH');
    if (!historical && ticketConsentCompatibility(p, command.episodeId) !== 'CURRENT_EPISODE_OPEN')
      consentConflict('CUSTOMER_CONSENT_CONTEXT_MISMATCH');
    return ticket!;
  }

  async authorize(
    input: CustomerConsentAuthorityInput,
  ): Promise<CustomerConsentActorAuthorization> {
    if (!this.authority) this.denied();
    // Override even an extra runtime field; callers cannot choose this binding.
    // This is correlation only. The provider must independently verify/consume intent.
    const request = freezeConsentData({
      ...consentDataCopy(input),
      verificationAttemptId: randomUUID(),
    });
    let response: CustomerConsentActorAuthorization | null;
    try {
      response = await this.authority!.authorize(request);
    } catch {
      throw new ServiceUnavailableException({
        code: 'CUSTOMER_CONSENT_AUTHORITY_UNAVAILABLE',
        message: 'Customer Consent authority could not be verified',
      });
    }
    if (!response) this.denied();
    try {
      const result = consentDataCopy(response!);
      consentShape(result, ['request', 'actor', 'customerAuthority']);
      consentPerson(result.actor);
      consentShape(result.customerAuthority, ['kind', 'organizationId', 'evidence']);
      consentEvidence(result.customerAuthority.evidence);
      if (
        !isDeepStrictEqual(result.request, request) ||
        result.actor.accountId !== request.actorUserId ||
        result.actor.provenance.status !== 'CURRENT' ||
        result.customerAuthority.kind !== 'ORGANIZATION_OWNER' ||
        result.customerAuthority.organizationId !== request.ticket.organizationId ||
        result.customerAuthority.evidence.status !== 'CURRENT'
      )
        this.denied();
      return freezeConsentData(result);
    } catch (error) {
      if (error instanceof ForbiddenException) throw error;
      this.denied();
    }
  }

  assertBinding(p: CustomerConsentProps, command: CustomerConsentTicketCommand, consentId: string) {
    if (
      p.consentId !== consentId ||
      p.organizationId !== command.organizationId ||
      p.ticketId !== command.ticketId ||
      p.episodeId !== command.episodeId ||
      !isDeepStrictEqual(p.scope, command.scope)
    )
      throw new NotFoundException({
        code: 'CUSTOMER_CONSENT_NOT_FOUND',
        message: 'Customer Consent is unavailable in this scope',
      });
  }
  private denied(): never {
    throw new ForbiddenException({
      code: 'CUSTOMER_CONSENT_ACCESS_DENIED',
      message: 'Verified Customer Consent action authority is required',
    });
  }
}
