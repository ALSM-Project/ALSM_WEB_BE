import type { SupportTicketEntity } from './support-ticket.entity';

export const SUPPORT_TICKET_LISTING = Symbol('SUPPORT_TICKET_LISTING');
export const SUPPORT_TICKET_PAGE_MAX = 50;
export const SUPPORT_TICKET_PAGE_DEFAULT = 20;

export interface SupportTicketListingPort {
  /** Ascending immutable Ticket ID, at most limit + 1 entries, always scoped. */
  list(
    organizationId: string,
    limit: number,
    afterTicketId?: string,
  ): Promise<SupportTicketEntity[]>;
}
