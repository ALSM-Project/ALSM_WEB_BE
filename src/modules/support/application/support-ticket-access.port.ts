import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { SupportTicketAction } from '../domain/support-ticket.types';

export const SUPPORT_TICKET_ACCESS = Symbol('SUPPORT_TICKET_ACCESS');

export interface SupportTicketAccessRequest {
  readonly actorUserId: string;
  readonly organizationId: string;
  readonly action: 'CREATE' | 'READ' | 'LIST' | SupportTicketAction;
  readonly ticketId?: string;
}

/**
 * Adapters must verify current Organisation membership and approved action scope.
 * Roles or body-supplied flags are no proof. Missing adapters never grant access.
 */
export interface SupportTicketAccessPort {
  authorize(request: SupportTicketAccessRequest): Promise<boolean>;
}

export async function requireSupportTicketAccess(
  access: SupportTicketAccessPort | undefined,
  request: SupportTicketAccessRequest,
): Promise<void> {
  const ids = [request.actorUserId, request.organizationId];
  if (request.action !== 'CREATE' && request.action !== 'LIST') ids.push(request.ticketId ?? '');
  if (ids.some((id) => typeof id !== 'string' || !/^[^\s\p{Cc}]+$/u.test(id))) {
    throw new BadRequestException({
      code: 'INVALID_SUPPORT_TICKET',
      message: 'Valid identifiers are required',
    });
  }
  if (!access || (await access.authorize(request)) !== true) {
    throw new ForbiddenException({
      code: 'SUPPORT_TICKET_ACCESS_DENIED',
      message: 'Support Ticket access is unavailable',
    });
  }
}
