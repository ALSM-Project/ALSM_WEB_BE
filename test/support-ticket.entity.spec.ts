import { SupportTicketEntity } from '../src/modules/support/domain/support-ticket.entity';
import type { SupportTicketProps } from '../src/modules/support/domain/support-ticket.types';

const startedAt = new Date('2026-10-29T01:00:00.000Z');
const endedAt = new Date('2026-10-29T02:00:00.000Z');
const reopenedAt = new Date('2026-10-29T03:00:00.000Z');

function create() {
  return SupportTicketEntity.createNew({
    ticketId: 'ticket-1',
    organizationId: 'org-1',
    episodeId: 'episode-1',
    requesterUserId: 'requester-1',
    purposeId: 'diagnose-rendering',
    now: startedAt,
  });
}

function claimedReferences(): SupportTicketProps {
  return {
    ...create().toProps(),
    decisionReferences: {
      ticketId: 'ticket-1',
      organizationId: 'org-1',
      episodeId: 'episode-1',
      customerConsent: {
        authorityId: 'unverified-customer',
        evidenceId: 'consent-1',
        revision: 'r1',
        generation: 'g1',
      },
      internalApproval: {
        authorityId: 'unverified-internal',
        evidenceId: 'approval-1',
        revision: 'r2',
        generation: 'g2',
      },
    },
  };
}

describe('SupportTicketEntity bounded lifecycle', () => {
  it('creates an open first-party ticket with immutable scope and no decision claims', () => {
    expect(create().toProps()).toEqual({
      ticketId: 'ticket-1',
      organizationId: 'org-1',
      episodeId: 'episode-1',
      requesterUserId: 'requester-1',
      purposeId: 'diagnose-rendering',
      status: 'OPEN',
      revision: 0,
      createdAt: startedAt,
      updatedAt: startedAt,
      decisionReferences: null,
      episodes: [
        {
          episodeId: 'episode-1',
          openedAt: startedAt,
          openedBy: 'requester-1',
          endedAt: null,
          endedBy: null,
          outcome: null,
        },
      ],
    });
  });

  it.each(['ticketId', 'organizationId', 'episodeId', 'requesterUserId', 'purposeId'] as const)(
    'rejects a missing %s during reconstitution',
    (field) => {
      expect(() =>
        SupportTicketEntity.fromPersistence({ ...create().toProps(), [field]: '' }),
      ).toThrow('INVALID_SUPPORT_TICKET');
    },
  );

  it.each([' ', 'ticket 1', 'ticket\n1', '\u0000', undefined, null, 42])(
    'rejects malformed identifiers (%s)',
    (ticketId) => {
      expect(() =>
        SupportTicketEntity.fromPersistence({
          ...create().toProps(),
          ticketId,
        } as SupportTicketProps),
      ).toThrow('INVALID_SUPPORT_TICKET');
    },
  );

  it.each(['UNKNOWN', 'RESOLVED', null, undefined])('rejects unrecognized status %s', (status) => {
    expect(() =>
      SupportTicketEntity.fromPersistence({ ...create().toProps(), status } as SupportTicketProps),
    ).toThrow('INVALID_SUPPORT_TICKET');
  });

  it.each([-1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid revision %s',
    (revision) => {
      expect(() =>
        SupportTicketEntity.fromPersistence({ ...create().toProps(), revision }),
      ).toThrow('INVALID_SUPPORT_TICKET');
    },
  );

  it.each(['CLOSED', 'CANCELLED'] as const)(
    'ends an OPEN episode as %s and clears both claimed references',
    (status) => {
      const props = claimedReferences();
      const ticket = SupportTicketEntity.fromPersistence(props);
      if (status === 'CLOSED') ticket.close('operator-1', endedAt);
      else ticket.cancel('operator-1', endedAt);
      expect(ticket.toProps()).toMatchObject({
        status,
        revision: 1,
        episodeId: 'episode-1',
        updatedAt: endedAt,
        decisionReferences: null,
        episodes: [{ endedAt, endedBy: 'operator-1', outcome: status }],
      });
      expect(props.decisionReferences?.customerConsent).not.toBeNull();
      expect(props.decisionReferences?.internalApproval).not.toBeNull();
    },
  );

  it.each(['CLOSED', 'CANCELLED'] as const)(
    'reopens %s in a fresh episode without previous claims',
    (status) => {
      const ticket = SupportTicketEntity.fromPersistence(claimedReferences());
      if (status === 'CLOSED') ticket.close('operator-1', endedAt);
      else ticket.cancel('operator-1', endedAt);
      ticket.reopen('operator-2', reopenedAt, 'episode-2');
      const result = ticket.toProps();
      expect(result).toMatchObject({
        ticketId: 'ticket-1',
        organizationId: 'org-1',
        requesterUserId: 'requester-1',
        purposeId: 'diagnose-rendering',
        status: 'OPEN',
        episodeId: 'episode-2',
        revision: 2,
        createdAt: startedAt,
        updatedAt: reopenedAt,
        decisionReferences: null,
      });
      expect(result.episodes).toEqual([
        {
          episodeId: 'episode-1',
          openedAt: startedAt,
          openedBy: 'requester-1',
          endedAt,
          endedBy: 'operator-1',
          outcome: status,
        },
        {
          episodeId: 'episode-2',
          openedAt: reopenedAt,
          openedBy: 'operator-2',
          endedAt: null,
          endedBy: null,
          outcome: null,
        },
      ]);
      expect(() =>
        SupportTicketEntity.fromPersistence({
          ...result,
          decisionReferences: claimedReferences().decisionReferences,
        }),
      ).toThrow('INVALID_SUPPORT_TICKET');
    },
  );

  it.each(['CLOSED', 'CANCELLED'] as const)(
    'rejects restoration of references on %s tickets',
    (status) => {
      const ticket = create();
      if (status === 'CLOSED') ticket.close('operator-1', endedAt);
      else ticket.cancel('operator-1', endedAt);
      expect(() =>
        SupportTicketEntity.fromPersistence({
          ...ticket.toProps(),
          decisionReferences: claimedReferences().decisionReferences,
        }),
      ).toThrow('INVALID_SUPPORT_TICKET');
    },
  );

  it.each([
    ['CLOSED', 'close'],
    ['CLOSED', 'cancel'],
    ['CANCELLED', 'close'],
    ['CANCELLED', 'cancel'],
  ] as const)('rejects %s -> %s without changing state', (initial, operation) => {
    const ticket = create();
    if (initial === 'CLOSED') ticket.close('operator-1', endedAt);
    else ticket.cancel('operator-1', endedAt);
    const before = ticket.toProps();
    expect(() => ticket[operation]('operator-1', reopenedAt)).toThrow(
      'SUPPORT_TICKET_INVALID_TRANSITION',
    );
    expect(ticket.toProps()).toEqual(before);
  });

  it('rejects reopening an already open ticket', () => {
    const ticket = create();
    expect(() => ticket.reopen('operator-1', endedAt, 'episode-2')).toThrow(
      'SUPPORT_TICKET_INVALID_TRANSITION',
    );
    expect(ticket.toProps()).toEqual(create().toProps());
  });

  it('cannot recycle any prior episode, including after a persistence round trip', () => {
    let ticket = create();
    ticket.close('operator-1', endedAt);
    ticket.reopen('operator-1', reopenedAt, 'episode-2');
    ticket.cancel('operator-1', reopenedAt);
    ticket = SupportTicketEntity.fromPersistence(ticket.toProps());
    const before = ticket.toProps();
    for (const id of ['episode-1', 'episode-2']) {
      expect(() => ticket.reopen('operator-1', reopenedAt, id)).toThrow(
        'SUPPORT_TICKET_EPISODE_REUSED',
      );
      expect(ticket.toProps()).toEqual(before);
    }
    ticket.reopen('operator-1', reopenedAt, 'episode-3');
    expect(ticket.toProps().decisionReferences).toBeNull();
  });

  it.each(['close', 'cancel', 'reopen'] as const)(
    'rejects invalid clocks for %s without mutation',
    (operation) => {
      const ticket = create();
      if (operation === 'reopen') ticket.close('operator-1', endedAt);
      const before = ticket.toProps();
      for (const invalidTime of [new Date('invalid'), new Date(startedAt.getTime() - 1)]) {
        expect(() =>
          operation === 'reopen'
            ? ticket.reopen('operator-1', invalidTime, 'episode-2')
            : ticket[operation]('operator-1', invalidTime),
        ).toThrow('SUPPORT_TICKET_INVALID_TIME');
        expect(ticket.toProps()).toEqual(before);
      }
    },
  );

  it.each(['close', 'cancel', 'reopen'] as const)(
    'rejects a missing actor for %s without mutation',
    (operation) => {
      const ticket = create();
      if (operation === 'reopen') ticket.close('operator-1', endedAt);
      const before = ticket.toProps();
      expect(() =>
        operation === 'reopen'
          ? ticket.reopen('', reopenedAt, 'episode-2')
          : ticket[operation]('', reopenedAt),
      ).toThrow('INVALID_SUPPORT_TICKET');
      expect(ticket.toProps()).toEqual(before);
    },
  );

  it('keeps dates, episode history and retained claims detached from callers', () => {
    const input = claimedReferences();
    const ticket = SupportTicketEntity.fromPersistence(input);
    input.createdAt.setUTCFullYear(2000);
    input.episodes[0].openedAt.setUTCFullYear(2000);
    Reflect.set(input.decisionReferences!.customerConsent!, 'generation', 'forged');
    const snapshot = ticket.toProps();
    snapshot.updatedAt.setUTCFullYear(2000);
    snapshot.episodes[0].openedAt.setUTCFullYear(2000);
    Reflect.set(snapshot.decisionReferences!.internalApproval!, 'generation', 'forged');
    expect(ticket.toProps()).toEqual(claimedReferences());
  });

  it.each(['ticketId', 'organizationId', 'episodeId'] as const)(
    'rejects retained claims for another %s',
    (field) => {
      const props = claimedReferences();
      expect(() =>
        SupportTicketEntity.fromPersistence({
          ...props,
          decisionReferences: { ...props.decisionReferences!, [field]: 'another' },
        }),
      ).toThrow('INVALID_SUPPORT_TICKET');
    },
  );

  it.each([
    (p: SupportTicketProps) => ({ ...p, episodes: [] }),
    (p: SupportTicketProps) => ({ ...p, episodes: [{ ...p.episodes[0], episodeId: 'wrong' }] }),
    (p: SupportTicketProps) => ({ ...p, episodes: [{ ...p.episodes[0], endedBy: 'operator-1' }] }),
    (p: SupportTicketProps) => ({
      ...p,
      episodes: [{ ...p.episodes[0], openedBy: 'another-requester' }],
    }),
    (p: SupportTicketProps) => ({
      ...p,
      decisionReferences: {
        ...claimedReferences().decisionReferences!,
        customerConsent: undefined,
      },
    }),
  ])('rejects inconsistent persistence metadata (%#)', (corrupt) => {
    expect(() =>
      SupportTicketEntity.fromPersistence(corrupt(create().toProps()) as SupportTicketProps),
    ).toThrow('INVALID_SUPPORT_TICKET');
  });
});

describe('P2 regression: revision and episode history consistency', () => {
  function multiEpisode(status: 'OPEN' | 'CLOSED' | 'CANCELLED' = 'OPEN') {
    const ticket = create();
    ticket.close('operator-1', endedAt);
    ticket.reopen('operator-2', reopenedAt, 'episode-2');
    ticket.cancel('operator-2', reopenedAt);
    ticket.reopen('operator-3', reopenedAt, 'episode-3');
    if (status === 'CLOSED') ticket.close('operator-3', reopenedAt);
    if (status === 'CANCELLED') ticket.cancel('operator-3', reopenedAt);
    return ticket;
  }

  it.each(['OPEN', 'CLOSED', 'CANCELLED'] as const)(
    'rejects a reset revision for a reopened %s Ticket',
    (status) => {
      const props = multiEpisode(status).toProps();
      expect(() => SupportTicketEntity.fromPersistence({ ...props, revision: 0 })).toThrow(
        'INVALID_SUPPORT_TICKET',
      );
      expect(props.revision).toBe(status === 'OPEN' ? 4 : 5);
    },
  );

  it.each(['OPEN', 'CLOSED', 'CANCELLED'] as const)(
    'rejects truncated %s history without repairing it',
    (status) => {
      const props = multiEpisode(status).toProps();
      const truncated = { ...props, episodes: [props.episodes[0], props.episodes[2]] };
      expect(() => SupportTicketEntity.fromPersistence(truncated)).toThrow(
        'INVALID_SUPPORT_TICKET',
      );
      expect(truncated.revision).toBe(props.revision);
      expect(truncated.episodes.map((episode) => episode.episodeId)).toEqual([
        'episode-1',
        'episode-3',
      ]);
    },
  );

  it.each(['OPEN', 'CLOSED', 'CANCELLED'] as const)(
    'rejects a revision ahead of its %s lifecycle history',
    (status) => {
      const props = multiEpisode(status).toProps();
      expect(() =>
        SupportTicketEntity.fromPersistence({ ...props, revision: props.revision + 2 }),
      ).toThrow('INVALID_SUPPORT_TICKET');
    },
  );

  it.each([1, 2])('rejects a duplicate persisted episode ID at index %i', (duplicateIndex) => {
    const props = multiEpisode('CLOSED').toProps();
    const episodes = props.episodes.map((episode, index) =>
      index === duplicateIndex ? { ...episode, episodeId: 'episode-1' } : episode,
    );
    expect(() =>
      SupportTicketEntity.fromPersistence({
        ...props,
        episodeId: episodes[episodes.length - 1].episodeId,
        episodes,
      }),
    ).toThrow('SUPPORT_TICKET_EPISODE_REUSED');
  });

  const invalidHistories: readonly [
    string,
    (props: SupportTicketProps) => SupportTicketProps,
    string,
  ][] = [
    [
      'overlapping episodes',
      (p) => ({
        ...p,
        episodes: p.episodes.map((episode, index) =>
          index === 1 ? { ...episode, openedAt: startedAt } : episode,
        ),
      }),
      'INVALID_SUPPORT_TICKET',
    ],
    [
      'end before opening',
      (p) => ({
        ...p,
        episodes: p.episodes.map((episode, index) =>
          index === 1 ? { ...episode, endedAt: startedAt } : episode,
        ),
      }),
      'SUPPORT_TICKET_INVALID_TIME',
    ],
    [
      'end after update',
      (p) => ({
        ...p,
        episodes: p.episodes.map((episode, index) =>
          index === 2 ? { ...episode, endedAt: new Date(reopenedAt.getTime() + 1) } : episode,
        ),
      }),
      'SUPPORT_TICKET_INVALID_TIME',
    ],
    [
      'nonterminal historical episode',
      (p) => ({
        ...p,
        episodes: p.episodes.map((episode, index) =>
          index === 1 ? { ...episode, outcome: null, endedAt: null, endedBy: null } : episode,
        ),
      }),
      'INVALID_SUPPORT_TICKET',
    ],
    [
      'missing historical end',
      (p) => ({
        ...p,
        episodes: p.episodes.map((episode, index) =>
          index === 1 ? { ...episode, endedAt: null } : episode,
        ),
      }),
      'INVALID_SUPPORT_TICKET',
    ],
    [
      'wrong final outcome',
      (p) => ({
        ...p,
        episodes: p.episodes.map((episode, index) =>
          index === 2 ? { ...episode, outcome: 'CANCELLED' } : episode,
        ),
      }),
      'INVALID_SUPPORT_TICKET',
    ],
    [
      'wrong current episode ID',
      (p) => ({ ...p, episodeId: 'episode-1' }),
      'INVALID_SUPPORT_TICKET',
    ],
  ];

  it.each(invalidHistories)('rejects invalid ordering/status: %s', (_label, corrupt, code) => {
    expect(() =>
      SupportTicketEntity.fromPersistence(corrupt(multiEpisode('CLOSED').toProps())),
    ).toThrow(code);
  });

  it.each(['CLOSED', 'CANCELLED'] as const)(
    'rejects %s snapshots whose last episode is still open',
    (status) => {
      const props = multiEpisode().toProps();
      expect(() =>
        SupportTicketEntity.fromPersistence({ ...props, status, revision: props.revision + 1 }),
      ).toThrow('INVALID_SUPPORT_TICKET');
    },
  );

  it('rejects OPEN snapshots whose last episode is terminal even with matching revision arithmetic', () => {
    const props = multiEpisode('CLOSED').toProps();
    expect(() =>
      SupportTicketEntity.fromPersistence({ ...props, status: 'OPEN', revision: 4 }),
    ).toThrow('INVALID_SUPPORT_TICKET');
  });

  it.each([null, undefined, 42])(
    'rejects malformed episode entries (%s) as domain failures',
    (episode) => {
      const props = { ...create().toProps(), episodes: [episode] } as unknown as SupportTicketProps;
      expect(() => SupportTicketEntity.fromPersistence(props)).toThrow('INVALID_SUPPORT_TICKET');
    },
  );

  it.each(['OPEN', 'CLOSED', 'CANCELLED'] as const)(
    'round-trips valid %s snapshots with their complete history',
    (status) => {
      const props = multiEpisode(status).toProps();
      expect(SupportTicketEntity.fromPersistence(props).toProps()).toEqual(props);
    },
  );

  it('preserves correct revisions across multiple close/cancel/reopen cycles', () => {
    let ticket = create();
    for (let cycle = 0; cycle < 5; cycle++) {
      if (cycle % 2 === 0) ticket.close('operator-1', reopenedAt);
      else ticket.cancel('operator-1', reopenedAt);
      expect(ticket.toProps().revision).toBe(2 * cycle + 1);
      ticket = SupportTicketEntity.fromPersistence(ticket.toProps());
      ticket.reopen('operator-1', reopenedAt, `episode-${cycle + 2}`);
      expect(ticket.toProps().revision).toBe(2 * (cycle + 1));
      expect(ticket.toProps().episodes).toHaveLength(cycle + 2);
      ticket = SupportTicketEntity.fromPersistence(ticket.toProps());
    }
    expect(ticket.toProps().episodes.map((episode) => episode.episodeId)).toEqual([
      'episode-1',
      'episode-2',
      'episode-3',
      'episode-4',
      'episode-5',
      'episode-6',
    ]);
    expect(ticket.toProps().decisionReferences).toBeNull();
  });

  it.each(['CLOSED', 'CANCELLED'] as const)(
    'cannot reuse any old episode ID after reconstituting %s',
    (status) => {
      const props = multiEpisode(status).toProps();
      const ticket = SupportTicketEntity.fromPersistence(props);
      for (const episode of props.episodes) {
        expect(() => ticket.reopen('operator-1', reopenedAt, episode.episodeId)).toThrow(
          'SUPPORT_TICKET_EPISODE_REUSED',
        );
        expect(ticket.toProps()).toEqual(props);
      }
      ticket.reopen('operator-1', reopenedAt, 'episode-4');
      expect(ticket.toProps()).toMatchObject({
        revision: 6,
        status: 'OPEN',
        episodeId: 'episode-4',
        decisionReferences: null,
      });
      expect(ticket.toProps().episodes.slice(0, 3)).toEqual(props.episodes);
    },
  );
});
