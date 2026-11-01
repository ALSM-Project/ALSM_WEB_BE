import {
  BadRequestException,
  Inject,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  SUPPORT_TICKET_LISTING,
  SUPPORT_TICKET_PAGE_MAX,
  SupportTicketListingPort,
} from '../domain/support-ticket-listing.port';
import {
  SUPPORT_TICKET_ACCESS,
  SupportTicketAccessPort,
  requireSupportTicketAccess,
} from './support-ticket-access.port';

@Injectable()
export class ListSupportTicketsService {
  constructor(
    @Inject(SUPPORT_TICKET_LISTING) private readonly tickets: SupportTicketListingPort,
    @Optional() @Inject(SUPPORT_TICKET_ACCESS) private readonly access?: SupportTicketAccessPort,
  ) {}

  async execute(input: {
    readonly actorUserId: string;
    readonly organizationId: string;
    readonly limit: number;
    readonly afterTicketId?: string;
  }) {
    const { actorUserId, organizationId, limit, afterTicketId } = input;
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > SUPPORT_TICKET_PAGE_MAX ||
      (afterTicketId !== undefined &&
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
          afterTicketId,
        ))
    )
      throw new BadRequestException({
        code: 'INVALID_SUPPORT_TICKET',
        message: 'Invalid Ticket page',
      });
    await requireSupportTicketAccess(this.access, { actorUserId, organizationId, action: 'LIST' });
    const results = (await this.tickets.list(organizationId, limit, afterTicketId)).map((ticket) =>
      ticket.toProps(),
    );
    // Defend the projection even against an incorrectly implemented read adapter.
    if (
      results.length > limit + 1 ||
      results.some(
        (ticket, index) =>
          ticket.organizationId !== organizationId ||
          (index > 0 && results[index - 1].ticketId >= ticket.ticketId) ||
          (afterTicketId !== undefined && ticket.ticketId <= afterTicketId),
      )
    )
      throw new ServiceUnavailableException({
        code: 'SUPPORT_TICKET_SNAPSHOT_INVALID',
        message: 'Stored Support Ticket page is invalid',
      });
    const items = results.slice(0, limit);
    return {
      items,
      nextAfterTicketId: results.length > limit ? items[items.length - 1].ticketId : null,
    };
  }
}
