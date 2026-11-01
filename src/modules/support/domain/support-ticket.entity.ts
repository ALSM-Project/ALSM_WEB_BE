import type { AuthorityRevisionReference } from './ticket-consent-boundary.contracts';
import {
  CreateSupportTicketInput,
  SupportTicketEpisode,
  SupportTicketError,
  SupportTicketProps,
  SupportTicketStatus,
  requireSupportTicketIdentifier,
} from './support-ticket.types';

function time(value: Date): number {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new SupportTicketError('SUPPORT_TICKET_INVALID_TIME');
  }
  return value.getTime();
}

function validateReference(reference: AuthorityRevisionReference | null): void {
  if (reference === null) return;
  if (!reference || typeof reference !== 'object') {
    throw new SupportTicketError('INVALID_SUPPORT_TICKET');
  }
  for (const field of ['authorityId', 'evidenceId', 'revision', 'generation'] as const) {
    requireSupportTicketIdentifier(reference[field]);
  }
}

function copyReference(
  reference: AuthorityRevisionReference | null,
): AuthorityRevisionReference | null {
  return reference === null
    ? null
    : {
        authorityId: reference.authorityId,
        evidenceId: reference.evidenceId,
        revision: reference.revision,
        generation: reference.generation,
      };
}

/** Copy only domain fields, including dates, without retaining caller objects. */
function copyProps(props: SupportTicketProps): SupportTicketProps {
  const references = props.decisionReferences;
  return {
    ticketId: props.ticketId,
    organizationId: props.organizationId,
    episodeId: props.episodeId,
    requesterUserId: props.requesterUserId,
    purposeId: props.purposeId,
    status: props.status,
    revision: props.revision,
    createdAt: new Date(props.createdAt),
    updatedAt: new Date(props.updatedAt),
    episodes: props.episodes.map((episode) => ({
      episodeId: episode.episodeId,
      openedAt: new Date(episode.openedAt),
      openedBy: episode.openedBy,
      endedAt: episode.endedAt === null ? null : new Date(episode.endedAt),
      endedBy: episode.endedBy,
      outcome: episode.outcome,
    })),
    decisionReferences:
      references === null
        ? null
        : {
            ticketId: references.ticketId,
            organizationId: references.organizationId,
            episodeId: references.episodeId,
            customerConsent: copyReference(references.customerConsent),
            internalApproval: copyReference(references.internalApproval),
          },
  };
}

export class SupportTicketEntity {
  private constructor(private props: SupportTicketProps) {}

  static createNew(input: CreateSupportTicketInput): SupportTicketEntity {
    return SupportTicketEntity.fromPersistence({
      ticketId: input.ticketId,
      organizationId: input.organizationId,
      episodeId: input.episodeId,
      requesterUserId: input.requesterUserId,
      purposeId: input.purposeId,
      status: 'OPEN',
      revision: 0,
      createdAt: input.now,
      updatedAt: input.now,
      episodes: [
        {
          episodeId: input.episodeId,
          openedAt: input.now,
          openedBy: input.requesterUserId,
          endedAt: null,
          endedBy: null,
          outcome: null,
        },
      ],
      decisionReferences: null,
    });
  }

  /** Reconstitution validates persisted invariants; it does not verify authority. */
  static fromPersistence(props: SupportTicketProps): SupportTicketEntity {
    for (const identifier of [
      props.ticketId,
      props.organizationId,
      props.episodeId,
      props.requesterUserId,
      props.purposeId,
    ])
      requireSupportTicketIdentifier(identifier);
    if (
      !['OPEN', 'CLOSED', 'CANCELLED'].includes(props.status) ||
      !Number.isSafeInteger(props.revision) ||
      props.revision < 0 ||
      !Array.isArray(props.episodes) ||
      props.episodes.length === 0
    )
      throw new SupportTicketError('INVALID_SUPPORT_TICKET');

    // Each previous episode required an end and a reopen; the current episode
    // contributes one more transition only when terminal. This checks lifecycle
    // consistency, not the provenance or completeness of persisted history.
    const expectedRevision = 2 * (props.episodes.length - 1) + (props.status === 'OPEN' ? 0 : 1);
    if (props.revision !== expectedRevision) throw new SupportTicketError('INVALID_SUPPORT_TICKET');

    const createdAt = time(props.createdAt);
    const updatedAt = time(props.updatedAt);
    const ids = new Set<string>();
    let previousEnd = createdAt;
    for (const [index, episode] of props.episodes.entries()) {
      if (!episode || typeof episode !== 'object')
        throw new SupportTicketError('INVALID_SUPPORT_TICKET');
      requireSupportTicketIdentifier(episode.episodeId);
      requireSupportTicketIdentifier(episode.openedBy);
      if (ids.has(episode.episodeId)) throw new SupportTicketError('SUPPORT_TICKET_EPISODE_REUSED');
      ids.add(episode.episodeId);
      const openedAt = time(episode.openedAt);
      const isCurrent = index === props.episodes.length - 1;
      const expectedOutcome = isCurrent && props.status === 'OPEN' ? null : episode.outcome;
      if (
        openedAt < previousEnd ||
        openedAt > updatedAt ||
        (index === 0 && (openedAt !== createdAt || episode.openedBy !== props.requesterUserId)) ||
        (isCurrent &&
          (episode.episodeId !== props.episodeId ||
            episode.outcome !== (props.status === 'OPEN' ? null : props.status))) ||
        (!isCurrent && !['CLOSED', 'CANCELLED'].includes(episode.outcome ?? ''))
      )
        throw new SupportTicketError('INVALID_SUPPORT_TICKET');
      if (expectedOutcome === null) {
        if (episode.endedAt !== null || episode.endedBy !== null) {
          throw new SupportTicketError('INVALID_SUPPORT_TICKET');
        }
      } else {
        if (episode.endedAt === null || episode.endedBy === null) {
          throw new SupportTicketError('INVALID_SUPPORT_TICKET');
        }
        requireSupportTicketIdentifier(episode.endedBy);
        previousEnd = time(episode.endedAt);
        if (previousEnd < openedAt || previousEnd > updatedAt) {
          throw new SupportTicketError('SUPPORT_TICKET_INVALID_TIME');
        }
      }
    }
    if (updatedAt < createdAt) throw new SupportTicketError('SUPPORT_TICKET_INVALID_TIME');
    const references = props.decisionReferences;
    if (references !== null) {
      if (
        !references ||
        props.status !== 'OPEN' ||
        references.ticketId !== props.ticketId ||
        references.organizationId !== props.organizationId ||
        references.episodeId !== props.episodeId
      ) {
        throw new SupportTicketError('INVALID_SUPPORT_TICKET');
      }
      validateReference(references.customerConsent);
      validateReference(references.internalApproval);
    }
    return new SupportTicketEntity(copyProps(props));
  }

  close(actorUserId: string, now: Date): void {
    this.end('CLOSED', actorUserId, now);
  }

  cancel(actorUserId: string, now: Date): void {
    this.end('CANCELLED', actorUserId, now);
  }

  reopen(actorUserId: string, now: Date, episodeId: string): void {
    if (this.props.status === 'OPEN')
      throw new SupportTicketError('SUPPORT_TICKET_INVALID_TRANSITION');
    requireSupportTicketIdentifier(episodeId);
    if (this.props.episodes.some((episode) => episode.episodeId === episodeId)) {
      throw new SupportTicketError('SUPPORT_TICKET_EPISODE_REUSED');
    }
    this.validateChange(actorUserId, now);
    this.props = {
      ...this.props,
      episodeId,
      status: 'OPEN',
      revision: this.props.revision + 1,
      updatedAt: new Date(now),
      episodes: [
        ...this.props.episodes,
        {
          episodeId,
          openedAt: new Date(now),
          openedBy: actorUserId,
          endedAt: null,
          endedBy: null,
          outcome: null,
        },
      ],
      decisionReferences: null,
    };
  }

  toProps(): SupportTicketProps {
    return copyProps(this.props);
  }

  private end(status: Exclude<SupportTicketStatus, 'OPEN'>, actorUserId: string, now: Date): void {
    if (this.props.status !== 'OPEN')
      throw new SupportTicketError('SUPPORT_TICKET_INVALID_TRANSITION');
    this.validateChange(actorUserId, now);
    const episodes: SupportTicketEpisode[] = this.props.episodes.map((episode, index) =>
      index === this.props.episodes.length - 1
        ? { ...episode, endedAt: new Date(now), endedBy: actorUserId, outcome: status }
        : episode,
    );
    this.props = {
      ...this.props,
      status,
      revision: this.props.revision + 1,
      updatedAt: new Date(now),
      episodes,
      decisionReferences: null,
    };
  }

  private validateChange(actorUserId: string, now: Date): void {
    requireSupportTicketIdentifier(actorUserId);
    if (time(now) < time(this.props.updatedAt))
      throw new SupportTicketError('SUPPORT_TICKET_INVALID_TIME');
    if (this.props.revision === Number.MAX_SAFE_INTEGER)
      throw new SupportTicketError('INVALID_SUPPORT_TICKET');
  }
}
