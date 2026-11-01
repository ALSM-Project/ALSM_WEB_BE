import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  SUPPORT_TICKET_REPOSITORY,
  SupportTicketRepository,
} from '../domain/support-ticket.repository';
import {
  SupportTicketAction,
  SupportTicketError,
  SupportTicketProps,
} from '../domain/support-ticket.types';
import {
  SUPPORT_TICKET_ACCESS,
  SupportTicketAccessPort,
  requireSupportTicketAccess,
} from './support-ticket-access.port';

export interface TransitionSupportTicketCommand {
  readonly actorUserId: string;
  readonly organizationId: string;
  readonly ticketId: string;
  readonly action: SupportTicketAction;
  readonly expectedRevision: number;
}

@Injectable()
export class TransitionSupportTicketService {
  constructor(
    @Inject(SUPPORT_TICKET_REPOSITORY) private readonly tickets: SupportTicketRepository,
    @Optional() @Inject(SUPPORT_TICKET_ACCESS) private readonly access?: SupportTicketAccessPort,
  ) {}

  async execute(input: TransitionSupportTicketCommand): Promise<SupportTicketProps> {
    // Use the same primitive snapshot for validation, authorization and effects.
    const { actorUserId, organizationId, ticketId, action, expectedRevision } = input;
    if (
      !['CLOSE', 'CANCEL', 'REOPEN'].includes(action) ||
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 0
    ) {
      throw new BadRequestException({
        code: 'INVALID_SUPPORT_TICKET',
        message: 'Valid action and revision are required',
      });
    }
    await requireSupportTicketAccess(this.access, {
      actorUserId,
      organizationId,
      ticketId,
      action,
    });
    const ticket = await this.tickets.findById(ticketId, organizationId);
    const current = ticket?.toProps();
    if (
      !ticket ||
      !current ||
      current.organizationId !== organizationId ||
      current.ticketId !== ticketId
    ) {
      throw new NotFoundException({
        code: 'SUPPORT_TICKET_NOT_FOUND',
        message: 'Support Ticket is unavailable',
      });
    }
    if (current.revision !== expectedRevision) this.conflict();
    try {
      const now = new Date();
      switch (action) {
        case 'CLOSE':
          ticket.close(actorUserId, now);
          break;
        case 'CANCEL':
          ticket.cancel(actorUserId, now);
          break;
        case 'REOPEN':
          ticket.reopen(actorUserId, now, randomUUID());
          break;
      }
    } catch (error) {
      if (!(error instanceof SupportTicketError)) throw error;
      throw new ConflictException({
        code: error.code,
        message: 'Support Ticket transition rejected',
      });
    }
    const result = ticket.toProps();
    if (!(await this.tickets.save(ticket, expectedRevision))) this.conflict();
    return result;
  }

  private conflict(): never {
    throw new ConflictException({
      code: 'SUPPORT_TICKET_CONFLICT',
      message: 'Support Ticket changed; reload before continuing',
    });
  }
}
