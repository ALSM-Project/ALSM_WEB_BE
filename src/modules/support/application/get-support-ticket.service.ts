import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import {
  SUPPORT_TICKET_REPOSITORY,
  SupportTicketRepository,
} from '../domain/support-ticket.repository';
import {
  SUPPORT_TICKET_ACCESS,
  SupportTicketAccessPort,
  requireSupportTicketAccess,
} from './support-ticket-access.port';

@Injectable()
export class GetSupportTicketService {
  constructor(
    @Inject(SUPPORT_TICKET_REPOSITORY) private readonly tickets: SupportTicketRepository,
    @Optional() @Inject(SUPPORT_TICKET_ACCESS) private readonly access?: SupportTicketAccessPort,
  ) {}

  async execute(input: {
    readonly actorUserId: string;
    readonly organizationId: string;
    readonly ticketId: string;
  }) {
    const { actorUserId, organizationId, ticketId } = input;
    await requireSupportTicketAccess(this.access, {
      actorUserId,
      organizationId,
      ticketId,
      action: 'READ',
    });
    const ticket = await this.tickets.findById(ticketId, organizationId);
    const props = ticket?.toProps();
    if (!props || props.organizationId !== organizationId || props.ticketId !== ticketId)
      throw new NotFoundException({
        code: 'SUPPORT_TICKET_NOT_FOUND',
        message: 'Support Ticket is unavailable',
      });
    return props;
  }
}
