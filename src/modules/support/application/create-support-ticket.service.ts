import { BadRequestException, Inject, Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { SupportTicketEntity } from '../domain/support-ticket.entity';
import {
  SUPPORT_TICKET_REPOSITORY,
  SupportTicketRepository,
} from '../domain/support-ticket.repository';
import { SupportTicketError, SupportTicketProps } from '../domain/support-ticket.types';
import {
  SUPPORT_TICKET_ACCESS,
  SupportTicketAccessPort,
  requireSupportTicketAccess,
} from './support-ticket-access.port';

export interface CreateSupportTicketCommand {
  readonly actorUserId: string;
  readonly organizationId: string;
  readonly purposeId: string;
}

@Injectable()
export class CreateSupportTicketService {
  constructor(
    @Inject(SUPPORT_TICKET_REPOSITORY) private readonly tickets: SupportTicketRepository,
    @Optional() @Inject(SUPPORT_TICKET_ACCESS) private readonly access?: SupportTicketAccessPort,
  ) {}

  async execute(input: CreateSupportTicketCommand): Promise<SupportTicketProps> {
    // Caller-owned commands may change while authorization or persistence waits.
    const { actorUserId, organizationId, purposeId } = input;
    await requireSupportTicketAccess(this.access, {
      actorUserId,
      organizationId,
      action: 'CREATE',
    });
    let ticket: SupportTicketEntity;
    try {
      ticket = SupportTicketEntity.createNew({
        ticketId: randomUUID(),
        episodeId: randomUUID(),
        organizationId,
        requesterUserId: actorUserId,
        purposeId,
        now: new Date(),
      });
    } catch (error) {
      if (!(error instanceof SupportTicketError)) throw error;
      throw new BadRequestException({ code: error.code, message: 'Invalid Support Ticket' });
    }
    const result = ticket.toProps();
    await this.tickets.create(ticket);
    return result;
  }
}
