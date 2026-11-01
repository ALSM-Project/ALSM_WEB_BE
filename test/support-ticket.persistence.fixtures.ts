import { randomUUID } from 'node:crypto';
import { SupportTicketEntity } from '../src/modules/support/domain/support-ticket.entity';
import type { SupportTicketStatus } from '../src/modules/support/domain/support-ticket.types';

export const organizationId = '111111111111111111111111';
export const requesterId = '222222222222222222222222';
export const operatorId = '333333333333333333333333';
export const foreignId = '444444444444444444444444';
export const at = (step: number) => new Date(Date.UTC(2026, 9, 29, 0, step));

export function newTicket(ticketId = randomUUID()) {
  return SupportTicketEntity.createNew({
    ticketId,
    organizationId,
    requesterUserId: requesterId,
    purposeId: 'TEST-diagnosis',
    episodeId: randomUUID(),
    now: at(0),
  });
}
export function historyTicket(status: SupportTicketStatus = 'OPEN') {
  const ticket = newTicket();
  ticket.close(operatorId, at(1));
  ticket.reopen(operatorId, at(2), randomUUID());
  ticket.cancel(operatorId, at(3));
  ticket.reopen(operatorId, at(4), randomUUID());
  if (status === 'CLOSED') ticket.close(operatorId, at(5));
  if (status === 'CANCELLED') ticket.cancel(operatorId, at(5));
  return ticket;
}
export function retainedClaims(ticket = newTicket()) {
  const props = ticket.toProps();
  return SupportTicketEntity.fromPersistence({
    ...props,
    decisionReferences: {
      ticketId: props.ticketId,
      organizationId: props.organizationId,
      episodeId: props.episodeId,
      customerConsent: {
        authorityId: 'unverified-customer',
        evidenceId: 'consent',
        revision: 'r1',
        generation: 'g1',
      },
      internalApproval: {
        authorityId: 'unverified-internal',
        evidenceId: 'approval',
        revision: 'r1',
        generation: 'g1',
      },
    },
  });
}
