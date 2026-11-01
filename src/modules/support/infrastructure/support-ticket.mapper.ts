import { Types } from 'mongoose';
import type { AuthorityRevisionReference } from '../domain/ticket-consent-boundary.contracts';
import { SupportTicketEntity } from '../domain/support-ticket.entity';
import {
  SupportTicketError,
  SupportTicketProps,
  SupportTicketStatus,
  requireSupportTicketIdentifier,
} from '../domain/support-ticket.types';
import type { SupportTicket } from './support-ticket.schema';

function invalid(): never {
  throw new SupportTicketError('INVALID_SUPPORT_TICKET');
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function identifier(value: unknown): string {
  if (typeof value !== 'string') invalid();
  requireSupportTicketIdentifier(value);
  return value;
}
/** Reject noncanonical identities; never manufacture ObjectIds for slugs/missing IDs. */
function identity(value: unknown): string {
  const id = identifier(value);
  if (!/^[a-f0-9]{24}$/.test(id)) invalid();
  return id;
}
function bsonIdentity(value: unknown): string {
  if (!(value instanceof Types.ObjectId)) invalid();
  return identity(value.toHexString());
}
function date(value: unknown): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) invalid();
  return new Date(value);
}
function reference(value: unknown): AuthorityRevisionReference | null {
  if (value === null) return null;
  const fields = record(value);
  return {
    authorityId: identifier(fields.authorityId),
    evidenceId: identifier(fields.evidenceId),
    revision: identifier(fields.revision),
    generation: identifier(fields.generation),
  };
}

/** Raw/lean BSON only: hydration defaults/casting must not repair corrupt snapshots. */
export function supportTicketFromSnapshot(value: unknown): SupportTicketEntity {
  const fields = record(value);
  if (!Array.isArray(fields.episodes) || typeof fields.revision !== 'number') invalid();
  const decisions = fields.decisionReferences === null ? null : record(fields.decisionReferences);
  const props: SupportTicketProps = {
    ticketId: identifier(fields._id),
    organizationId: bsonIdentity(fields.organizationId),
    requesterUserId: bsonIdentity(fields.requesterUserId),
    purposeId: identifier(fields.purposeId),
    status: fields.status as SupportTicketStatus,
    revision: fields.revision,
    episodeId: identifier(fields.episodeId),
    createdAt: date(fields.createdAt),
    updatedAt: date(fields.updatedAt),
    episodes: fields.episodes.map((value) => {
      const episode = record(value);
      return {
        episodeId: identifier(episode.episodeId),
        openedAt: date(episode.openedAt),
        openedBy: identity(episode.openedBy),
        endedAt: episode.endedAt === null ? null : date(episode.endedAt),
        endedBy: episode.endedBy === null ? null : identity(episode.endedBy),
        outcome: episode.outcome as 'CLOSED' | 'CANCELLED' | null,
      };
    }),
    decisionReferences:
      decisions === null
        ? null
        : {
            ticketId: identifier(decisions.ticketId),
            organizationId: identity(decisions.organizationId),
            episodeId: identifier(decisions.episodeId),
            customerConsent: reference(decisions.customerConsent),
            internalApproval: reference(decisions.internalApproval),
          },
  };
  return SupportTicketEntity.fromPersistence(props);
}

export function supportTicketToSnapshot(ticket: SupportTicketEntity): SupportTicket {
  const props = SupportTicketEntity.fromPersistence(ticket.toProps()).toProps();
  for (const episode of props.episodes) {
    identity(episode.openedBy);
    if (episode.endedBy !== null) identity(episode.endedBy);
  }
  return {
    _id: props.ticketId,
    organizationId: new Types.ObjectId(identity(props.organizationId)),
    requesterUserId: new Types.ObjectId(identity(props.requesterUserId)),
    purposeId: props.purposeId,
    status: props.status,
    revision: props.revision,
    episodeId: props.episodeId,
    createdAt: props.createdAt,
    updatedAt: props.updatedAt,
    episodes: [...props.episodes],
    decisionReferences: props.decisionReferences,
  };
}

export function supportTicketScope(ticketId: string, organizationId: string) {
  return {
    _id: identifier(ticketId),
    ...supportTicketOrganizationScope(organizationId),
  };
}

export function supportTicketOrganizationScope(organizationId: string) {
  return { organizationId: new Types.ObjectId(identity(organizationId)) };
}
