import type { SupportTicketEntity } from './support-ticket.entity';

export const SUPPORT_TICKET_REPOSITORY = Symbol('SUPPORT_TICKET_REPOSITORY');

export interface SupportTicketRepository {
  /** Insert only; duplicate ticket IDs must fail, never overwrite or upsert. */
  create(ticket: SupportTicketEntity): Promise<void>;
  findById(ticketId: string, organizationId: string): Promise<SupportTicketEntity | null>;
  /**
   * Atomically replace lifecycle state AND cleared references, matching ticketId,
   * organizationId and expectedRevision. False means no write. Never blind-retry.
   */
  save(ticket: SupportTicketEntity, expectedRevision: number): Promise<boolean>;
}
