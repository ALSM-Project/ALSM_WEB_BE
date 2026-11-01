import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isUUID } from 'class-validator';
import { RequestWithContext } from '../../../shared/logging/request-id.middleware';
import {
  SUPPORT_TICKET_ACCESS,
  SupportTicketAccessPort,
  SupportTicketAccessRequest,
  requireSupportTicketAccess,
} from '../application/support-ticket-access.port';

const TICKET_ACTION = Symbol('TICKET_ACTION');
export const SupportTicketOperation = (action: SupportTicketAccessRequest['action']) =>
  SetMetadata(TICKET_ACTION, action);

@Injectable()
export class SupportTicketOwnerGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(SUPPORT_TICKET_ACCESS) private readonly access: SupportTicketAccessPort,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithContext>();
    const actorUserId = request.user?.userId ?? '';
    const { organizationId, ticketId } = request.params;
    const action = this.reflector.get<SupportTicketAccessRequest['action']>(
      TICKET_ACTION,
      context.getHandler(),
    );
    if (
      typeof organizationId !== 'string' ||
      !/^[a-f0-9]{24}$/.test(organizationId) ||
      (ticketId !== undefined && (typeof ticketId !== 'string' || !isUUID(ticketId, '4')))
    )
      throw new BadRequestException({
        code: 'INVALID_SUPPORT_TICKET',
        message: 'Invalid Ticket scope',
      });
    // Missing operation metadata cannot turn a new route into a default grant.
    if (!action) return false;
    await requireSupportTicketAccess(this.access, {
      actorUserId,
      organizationId,
      ticketId,
      action,
    });
    return true;
  }
}
