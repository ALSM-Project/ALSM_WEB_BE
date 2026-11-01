import type {
  AuthorityRevisionReference,
  FirstPartyTicketReference,
  TicketEpisodeIdentity,
} from './ticket-consent-boundary.contracts';

export type SupportTicketStatus = Exclude<FirstPartyTicketReference['status'], 'UNKNOWN'>;
export type SupportTicketAction = 'CLOSE' | 'CANCEL' | 'REOPEN';

export interface SupportTicketEpisode {
  readonly episodeId: string;
  readonly openedAt: Date;
  readonly openedBy: string;
  readonly endedAt: Date | null;
  readonly endedBy: string | null;
  readonly outcome: Exclude<SupportTicketStatus, 'OPEN'> | null;
}

/** Retained claims only. Persistence of a reference never authenticates a decision. */
export interface SupportTicketDecisionReferences extends TicketEpisodeIdentity {
  readonly customerConsent: AuthorityRevisionReference | null;
  readonly internalApproval: AuthorityRevisionReference | null;
}

export interface SupportTicketProps extends TicketEpisodeIdentity {
  readonly requesterUserId: string;
  readonly purposeId: string;
  readonly status: SupportTicketStatus;
  readonly revision: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly episodes: readonly SupportTicketEpisode[];
  readonly decisionReferences: SupportTicketDecisionReferences | null;
}

export interface CreateSupportTicketInput extends TicketEpisodeIdentity {
  readonly requesterUserId: string;
  readonly purposeId: string;
  readonly now: Date;
}

export type SupportTicketErrorCode =
  | 'INVALID_SUPPORT_TICKET'
  | 'SUPPORT_TICKET_INVALID_TRANSITION'
  | 'SUPPORT_TICKET_EPISODE_REUSED'
  | 'SUPPORT_TICKET_INVALID_TIME';

export class SupportTicketError extends Error {
  constructor(readonly code: SupportTicketErrorCode) {
    super(code);
    this.name = 'SupportTicketError';
  }
}

export function requireSupportTicketIdentifier(value: string): void {
  if (typeof value !== 'string' || !/^[^\s\p{Cc}]+$/u.test(value)) {
    throw new SupportTicketError('INVALID_SUPPORT_TICKET');
  }
}
