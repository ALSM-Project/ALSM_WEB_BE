import type { SupportTicketProps } from '../domain/support-ticket.types';

export class SupportTicketPresenter {
  static ticket(ticket: SupportTicketProps) {
    return {
      ticketId: ticket.ticketId,
      organizationId: ticket.organizationId,
      episodeId: ticket.episodeId,
      purposeId: ticket.purposeId,
      status: ticket.status,
      revision: ticket.revision,
      createdAt: ticket.createdAt.toISOString(),
      updatedAt: ticket.updatedAt.toISOString(),
    };
  }

  static page(page: { items: SupportTicketProps[]; nextAfterTicketId: string | null }) {
    return {
      items: page.items.map((ticket) => this.ticket(ticket)),
      nextAfterTicketId: page.nextAfterTicketId,
    };
  }
}
