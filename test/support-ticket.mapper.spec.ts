import { Mongoose } from 'mongoose';
import {
  supportTicketFromSnapshot,
  supportTicketScope,
  supportTicketToSnapshot,
} from '../src/modules/support/infrastructure/support-ticket.mapper';
import {
  SupportTicket,
  SupportTicketSchema,
} from '../src/modules/support/infrastructure/support-ticket.schema';
import {
  at,
  historyTicket,
  newTicket,
  organizationId,
  retainedClaims,
} from './support-ticket.persistence.fixtures';

describe('Support Ticket BSON schema and validated mapping (no database)', () => {
  it.each(['OPEN', 'CLOSED', 'CANCELLED'] as const)(
    'round-trips %s with string Ticket identity and complete history',
    (status) => {
      const ticket = historyTicket(status);
      const snapshot = supportTicketToSnapshot(ticket);
      expect(typeof snapshot._id).toBe('string');
      expect(snapshot.organizationId.toHexString()).toBe(organizationId);
      expect(supportTicketFromSnapshot(snapshot).toProps()).toEqual(ticket.toProps());
    },
  );

  it('returns detached dates, history and passive decision references', () => {
    const original = retainedClaims();
    const snapshot = supportTicketToSnapshot(original);
    const detached = supportTicketFromSnapshot(snapshot);
    snapshot.createdAt.setUTCFullYear(2000);
    snapshot.episodes[0].openedAt.setUTCFullYear(2000);
    Reflect.set(snapshot.decisionReferences!.customerConsent!, 'generation', 'changed');
    expect(detached.toProps()).toEqual(original.toProps());
    expect(detached).not.toHaveProperty('save');
  });

  it.each([
    '_id',
    'organizationId',
    'requesterUserId',
    'purposeId',
    'status',
    'revision',
    'episodeId',
    'episodes',
    'decisionReferences',
    'createdAt',
    'updatedAt',
  ])('rejects missing %s without supplying defaults', (field) => {
    const snapshot = { ...supportTicketToSnapshot(newTicket()) };
    Reflect.deleteProperty(snapshot, field);
    expect(() => supportTicketFromSnapshot(snapshot)).toThrow();
    expect(snapshot).not.toHaveProperty(field);
  });

  it.each(['', 'organisation-slug', 'AAAAAAAAAAAAAAAAAAAAAAAA', '123', undefined])(
    'rejects noncanonical Organisation identity %s',
    (id) => {
      expect(() => supportTicketScope('ticket', id as string)).toThrow('INVALID_SUPPORT_TICKET');
    },
  );

  it.each(['organizationId', 'requesterUserId'] as const)(
    'rejects a raw string in persisted BSON %s',
    (field) => {
      const snapshot = supportTicketToSnapshot(newTicket());
      expect(() => supportTicketFromSnapshot({ ...snapshot, [field]: organizationId })).toThrow(
        'INVALID_SUPPORT_TICKET',
      );
    },
  );

  it.each([
    ['reset revision', (s: SupportTicket) => ({ ...s, revision: 0 })],
    [
      'truncated history',
      (s: SupportTicket) => ({ ...s, episodes: [s.episodes[0], s.episodes[2]] }),
    ],
    [
      'duplicate history',
      (s: SupportTicket) => ({ ...s, episodes: [s.episodes[0], s.episodes[0], s.episodes[2]] }),
    ],
    [
      'overlapping episodes',
      (s: SupportTicket) => ({
        ...s,
        episodes: s.episodes.map((e, i) => (i === 1 ? { ...e, openedAt: at(0) } : e)),
      }),
    ],
    ['wrong final status', (s: SupportTicket) => ({ ...s, status: 'CANCELLED' })],
    ['string date', (s: SupportTicket) => ({ ...s, createdAt: s.createdAt.toISOString() })],
    [
      'malformed episode',
      (s: SupportTicket) => ({ ...s, episodes: [s.episodes[0], null, s.episodes[2]] }),
    ],
    ['unrecognized state', (s: SupportTicket) => ({ ...s, status: 'UNKNOWN' })],
  ] as const)('rejects corrupt persisted %s', (_name, corrupt) => {
    expect(() =>
      supportTicketFromSnapshot(corrupt(supportTicketToSnapshot(historyTicket('CLOSED')))),
    ).toThrow();
  });

  it('validates lifecycle invariants on Mongoose document validation without enabling timestamps/default repair', async () => {
    const model = new Mongoose().model(SupportTicket.name, SupportTicketSchema);
    const snapshot = supportTicketToSnapshot(historyTicket());
    await expect(new model(snapshot).validate()).resolves.toBeUndefined();
    await expect(new model({ ...snapshot, revision: 0 }).validate()).rejects.toThrow(
      'INVALID_SUPPORT_TICKET',
    );
    expect(SupportTicketSchema.options.timestamps).toBe(false);
    for (const path of ['_id', 'organizationId', 'requesterUserId', 'purposeId', 'createdAt']) {
      expect(SupportTicketSchema.path(path).options.immutable).toBe(true);
    }
  });
});
