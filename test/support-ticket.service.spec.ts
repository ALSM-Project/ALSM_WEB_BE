import { Test } from '@nestjs/testing';
import { CreateSupportTicketService } from '../src/modules/support/application/create-support-ticket.service';
import {
  SupportTicketAccessPort,
  SupportTicketAccessRequest,
} from '../src/modules/support/application/support-ticket-access.port';
import {
  TransitionSupportTicketCommand,
  TransitionSupportTicketService,
} from '../src/modules/support/application/transition-support-ticket.service';
import { SupportTicketEntity } from '../src/modules/support/domain/support-ticket.entity';
import {
  SUPPORT_TICKET_REPOSITORY,
  SupportTicketRepository,
} from '../src/modules/support/domain/support-ticket.repository';
import type { SupportTicketProps } from '../src/modules/support/domain/support-ticket.types';

const now = new Date('2026-10-29T04:00:00.000Z');
const command: TransitionSupportTicketCommand = {
  ticketId: 'ticket-1',
  organizationId: 'org-1',
  actorUserId: 'requester-1',
  action: 'CLOSE',
  expectedRevision: 0,
};

function openTicket() {
  const ticket = SupportTicketEntity.createNew({
    ticketId: command.ticketId,
    organizationId: command.organizationId,
    requesterUserId: command.actorUserId,
    purposeId: 'diagnose-rendering',
    episodeId: 'episode-1',
    now: new Date('2026-10-29T01:00:00.000Z'),
  });
  const props = ticket.toProps();
  return SupportTicketEntity.fromPersistence({
    ...props,
    decisionReferences: {
      ticketId: props.ticketId,
      organizationId: props.organizationId,
      episodeId: props.episodeId,
      customerConsent: {
        authorityId: 'unverified-customer',
        evidenceId: 'consent-1',
        revision: 'r1',
        generation: 'g1',
      },
      internalApproval: {
        authorityId: 'unverified-internal',
        evidenceId: 'approval-1',
        revision: 'r1',
        generation: 'g1',
      },
    },
  });
}

function fixture() {
  let persisted: SupportTicketProps | null = openTicket().toProps();
  const tickets: jest.Mocked<SupportTicketRepository> = {
    create: jest.fn().mockImplementation(async (ticket: SupportTicketEntity) => {
      persisted = ticket.toProps();
    }),
    findById: jest.fn().mockImplementation(async (ticketId: string, organizationId: string) => {
      if (
        !persisted ||
        persisted.ticketId !== ticketId ||
        persisted.organizationId !== organizationId
      )
        return null;
      return SupportTicketEntity.fromPersistence(persisted);
    }),
    // A local CAS fixture verifies service orchestration, not Mongo atomicity.
    save: jest.fn().mockImplementation(async (ticket: SupportTicketEntity, revision: number) => {
      const next = ticket.toProps();
      if (
        !persisted ||
        persisted.ticketId !== next.ticketId ||
        persisted.organizationId !== next.organizationId ||
        persisted.revision !== revision
      )
        return false;
      persisted = next;
      return true;
    }),
  };
  // An explicit unit-test fixture only; never installed in application DI.
  const access: jest.Mocked<SupportTicketAccessPort> = {
    authorize: jest.fn().mockResolvedValue(true),
  };
  return {
    tickets,
    access,
    persisted: () => structuredClone(persisted),
    create: new CreateSupportTicketService(tickets, access),
    transition: new TransitionSupportTicketService(tickets, access),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

describe('Support Ticket application slice', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(now);
  });
  afterEach(() => jest.useRealTimers());

  it('creates IDs server-side, derives the requester from the actor and ignores injected authority fields', async () => {
    const f = fixture();
    const result = await f.create.execute({
      actorUserId: 'requester-1',
      organizationId: 'org-1',
      purposeId: 'diagnose-rendering',
      ...{
        ticketId: 'forged-ticket',
        episodeId: 'forged-episode',
        requesterUserId: 'another-user',
        status: 'CLOSED',
        decisionReferences: openTicket().toProps().decisionReferences,
        operationalAccess: true,
        isPlatformAdmin: true,
      },
    });
    expect(f.access.authorize).toHaveBeenCalledWith({
      actorUserId: 'requester-1',
      organizationId: 'org-1',
      action: 'CREATE',
    });
    expect(result).toMatchObject({
      organizationId: 'org-1',
      requesterUserId: 'requester-1',
      purposeId: 'diagnose-rendering',
      status: 'OPEN',
      revision: 0,
      createdAt: now,
      updatedAt: now,
      decisionReferences: null,
    });
    expect(result.ticketId).not.toBe('forged-ticket');
    expect(result.episodeId).not.toBe('forged-episode');
    expect(result.ticketId).not.toBe(result.episodeId);
    expect(result).not.toHaveProperty('operationalAccess');
    expect(result).not.toHaveProperty('isPlatformAdmin');
    expect(f.persisted()).toEqual(result);
    expect(f.tickets.findById).not.toHaveBeenCalled();
    expect(f.tickets.save).not.toHaveBeenCalled();
  });

  it('uses distinct ticket and episode identities on independent creations', async () => {
    const f = fixture();
    const input = {
      actorUserId: 'requester-1',
      organizationId: 'org-1',
      purposeId: 'diagnose-rendering',
    };
    const first = await f.create.execute(input);
    const second = await f.create.execute(input);
    expect(new Set([first.ticketId, first.episodeId, second.ticketId, second.episodeId]).size).toBe(
      4,
    );
  });

  it.each(['', 'has whitespace', undefined])(
    'rejects invalid purpose %s without creating a ticket',
    async (purposeId) => {
      const f = fixture();
      await expect(
        f.create.execute({
          actorUserId: 'requester-1',
          organizationId: 'org-1',
          purposeId: purposeId as string,
        }),
      ).rejects.toMatchObject({ status: 400, response: { code: 'INVALID_SUPPORT_TICKET' } });
      expect(f.tickets.create).not.toHaveBeenCalled();
    },
  );

  it.each(['CREATE', 'CLOSE', 'CANCEL', 'REOPEN'] as const)(
    'denies %s before any repository access without explicit permission',
    async (action) => {
      const f = fixture();
      f.access.authorize.mockResolvedValue(false);
      const result =
        action === 'CREATE'
          ? f.create.execute({
              actorUserId: command.actorUserId,
              organizationId: command.organizationId,
              purposeId: 'diagnose-rendering',
            })
          : f.transition.execute({ ...command, action });
      await expect(result).rejects.toMatchObject({
        status: 403,
        response: { code: 'SUPPORT_TICKET_ACCESS_DENIED' },
      });
      for (const method of Object.values(f.tickets)) expect(method).not.toHaveBeenCalled();
    },
  );

  it.each(['CREATE', 'CLOSE', 'CANCEL', 'REOPEN'] as const)(
    'fails closed for %s when authorization is unavailable',
    async (action) => {
      const f = fixture();
      f.access.authorize.mockRejectedValue(new Error('authority unavailable'));
      const result =
        action === 'CREATE'
          ? f.create.execute({
              actorUserId: command.actorUserId,
              organizationId: command.organizationId,
              purposeId: 'diagnose-rendering',
            })
          : f.transition.execute({ ...command, action });
      await expect(result).rejects.toThrow('authority unavailable');
      for (const method of Object.values(f.tickets)) expect(method).not.toHaveBeenCalled();
    },
  );

  it('requires the literal true result from the access port', async () => {
    const f = fixture();
    f.access.authorize.mockResolvedValue('true' as unknown as boolean);
    await expect(f.transition.execute(command)).rejects.toMatchObject({ status: 403 });
    expect(f.tickets.findById).not.toHaveBeenCalled();
  });

  it('has no default grant when the access provider is absent from Nest DI', async () => {
    const f = fixture();
    const moduleRef = await Test.createTestingModule({
      providers: [
        CreateSupportTicketService,
        TransitionSupportTicketService,
        { provide: SUPPORT_TICKET_REPOSITORY, useValue: f.tickets },
      ],
    }).compile();
    try {
      await expect(
        moduleRef.get(CreateSupportTicketService).execute({
          actorUserId: command.actorUserId,
          organizationId: command.organizationId,
          purposeId: 'diagnose-rendering',
        }),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        moduleRef.get(TransitionSupportTicketService).execute(command),
      ).rejects.toMatchObject({ status: 403 });
      for (const method of Object.values(f.tickets)) expect(method).not.toHaveBeenCalled();
    } finally {
      await moduleRef.close();
    }
  });

  it.each(['actorUserId', 'organizationId', 'ticketId'] as const)(
    'rejects a missing %s before authorizing',
    async (field) => {
      const f = fixture();
      await expect(f.transition.execute({ ...command, [field]: '' })).rejects.toMatchObject({
        status: 400,
      });
      expect(f.access.authorize).not.toHaveBeenCalled();
      expect(f.tickets.findById).not.toHaveBeenCalled();
    },
  );

  it.each(['actorUserId', 'organizationId'] as const)(
    'rejects create without %s before authorizing',
    async (field) => {
      const f = fixture();
      await expect(
        f.create.execute({
          actorUserId: command.actorUserId,
          organizationId: command.organizationId,
          purposeId: 'diagnose-rendering',
          [field]: '',
        }),
      ).rejects.toMatchObject({ status: 400 });
      expect(f.access.authorize).not.toHaveBeenCalled();
      expect(f.tickets.create).not.toHaveBeenCalled();
    },
  );

  it.each(['CLOSE', 'CANCEL', 'REOPEN'] as const)(
    'keeps %s lookups scoped to the authorized Organisation',
    async (action) => {
      const f = fixture();
      f.access.authorize.mockImplementation(
        async (request: SupportTicketAccessRequest) => request.organizationId === 'org-other',
      );
      await expect(
        f.transition.execute({ ...command, organizationId: 'org-other', action }),
      ).rejects.toMatchObject({ status: 404, response: { code: 'SUPPORT_TICKET_NOT_FOUND' } });
      expect(f.tickets.findById).toHaveBeenCalledWith(command.ticketId, 'org-other');
      expect(f.tickets.save).not.toHaveBeenCalled();
      expect(f.persisted()).toEqual(openTicket().toProps());
    },
  );

  it.each(['organizationId', 'ticketId'] as const)(
    'rejects a repository result for a different %s',
    async (field) => {
      const f = fixture();
      const props = openTicket().toProps();
      f.tickets.findById.mockResolvedValue(
        SupportTicketEntity.fromPersistence({
          ...props,
          [field]: 'other',
          decisionReferences: null,
        }),
      );
      await expect(f.transition.execute(command)).rejects.toMatchObject({ status: 404 });
      expect(f.tickets.save).not.toHaveBeenCalled();
    },
  );

  it.each(['CLOSE', 'CANCEL'] as const)(
    'persists %s and reference invalidation in one version-checked write',
    async (action) => {
      const f = fixture();
      const result = await f.transition.execute({ ...command, action });
      expect(f.access.authorize).toHaveBeenCalledWith({
        actorUserId: command.actorUserId,
        organizationId: command.organizationId,
        ticketId: command.ticketId,
        action,
      });
      expect(result).toMatchObject({
        status: action === 'CLOSE' ? 'CLOSED' : 'CANCELLED',
        revision: 1,
        decisionReferences: null,
      });
      expect(f.tickets.save).toHaveBeenCalledTimes(1);
      expect(f.tickets.save).toHaveBeenCalledWith(expect.any(SupportTicketEntity), 0);
      expect(f.persisted()).toEqual(result);
    },
  );

  it.each(['CLOSE', 'CANCEL'] as const)(
    'reopens after %s without restoring either previous decision reference',
    async (action) => {
      const f = fixture();
      const ended = await f.transition.execute({ ...command, action });
      const reopened = await f.transition.execute({
        ...command,
        action: 'REOPEN',
        expectedRevision: 1,
      });
      expect(reopened).toMatchObject({
        ticketId: ended.ticketId,
        organizationId: ended.organizationId,
        status: 'OPEN',
        requesterUserId: ended.requesterUserId,
        purposeId: ended.purposeId,
        revision: 2,
        decisionReferences: null,
      });
      expect(reopened.episodeId).not.toBe(ended.episodeId);
      expect(reopened.episodes).toHaveLength(2);
      expect(f.persisted()).toEqual(reopened);
      await expect(f.transition.execute({ ...command, expectedRevision: 0 })).rejects.toMatchObject(
        { status: 409, response: { code: 'SUPPORT_TICKET_CONFLICT' } },
      );
      expect(f.persisted()).toEqual(reopened);
    },
  );

  it.each([-1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, undefined])(
    'rejects invalid expected revision %s',
    async (expectedRevision) => {
      const f = fixture();
      await expect(
        f.transition.execute({ ...command, expectedRevision: expectedRevision as number }),
      ).rejects.toMatchObject({ status: 400 });
      expect(f.access.authorize).not.toHaveBeenCalled();
      expect(f.tickets.findById).not.toHaveBeenCalled();
    },
  );

  it.each(['OPEN', 'RESOLVE', '', undefined])(
    'rejects unknown action %s before authorization',
    async (action) => {
      const f = fixture();
      await expect(
        f.transition.execute({ ...command, action } as TransitionSupportTicketCommand),
      ).rejects.toMatchObject({ status: 400 });
      expect(f.access.authorize).not.toHaveBeenCalled();
      expect(f.tickets.findById).not.toHaveBeenCalled();
    },
  );

  it('does not write an invalid OPEN -> REOPEN transition', async () => {
    const f = fixture();
    await expect(f.transition.execute({ ...command, action: 'REOPEN' })).rejects.toMatchObject({
      status: 409,
      response: { code: 'SUPPORT_TICKET_INVALID_TRANSITION' },
    });
    expect(f.tickets.save).not.toHaveBeenCalled();
  });

  it('reports a stale revision without attempting a write', async () => {
    const f = fixture();
    await expect(f.transition.execute({ ...command, expectedRevision: 1 })).rejects.toMatchObject({
      status: 409,
    });
    expect(f.tickets.save).not.toHaveBeenCalled();
  });

  it('reports a lost compare-and-set without success or a blind retry', async () => {
    const f = fixture();
    f.tickets.save.mockResolvedValue(false);
    await expect(f.transition.execute(command)).rejects.toMatchObject({
      status: 409,
      response: { code: 'SUPPORT_TICKET_CONFLICT' },
    });
    expect(f.tickets.save).toHaveBeenCalledTimes(1);
    expect(f.persisted()).toEqual(openTicket().toProps());
  });

  it('allows one winner for competing close and cancel commands through the CAS port', async () => {
    const f = fixture();
    const results = await Promise.allSettled([
      f.transition.execute(command),
      f.transition.execute({ ...command, action: 'CANCEL' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toEqual([
      expect.objectContaining({ reason: expect.objectContaining({ status: 409 }) }),
    ]);
    expect(f.persisted()).toMatchObject({ revision: 1, decisionReferences: null });
  });

  it.each(['create', 'findById', 'save'] as const)(
    'propagates %s failure without reporting success or retrying',
    async (method) => {
      const f = fixture();
      f.tickets[method].mockRejectedValue(new Error('persistence unavailable'));
      const result =
        method === 'create'
          ? f.create.execute({
              actorUserId: command.actorUserId,
              organizationId: command.organizationId,
              purposeId: 'diagnose-rendering',
            })
          : f.transition.execute(command);
      await expect(result).rejects.toThrow('persistence unavailable');
      expect(f.tickets[method]).toHaveBeenCalledTimes(1);
      expect(f.persisted()).toEqual(openTicket().toProps());
    },
  );

  describe('P1 regression: caller-owned command mutation', () => {
    it.each([true, false])(
      'keeps create scope and requester while authorization waits (allowed=%s)',
      async (allowed) => {
        const f = fixture();
        const authorization = deferred<boolean>();
        f.access.authorize.mockReturnValueOnce(authorization.promise);
        const input = {
          actorUserId: 'requester-1',
          organizationId: 'org-1',
          purposeId: 'diagnose-rendering',
        };
        const pending = f.create.execute(input);
        Object.assign(input, {
          actorUserId: 'other-user',
          organizationId: 'other-org',
          purposeId: 'other-purpose',
        });
        authorization.resolve(allowed);
        if (allowed) {
          const result = await pending;
          expect(result).toMatchObject({
            requesterUserId: 'requester-1',
            organizationId: 'org-1',
            purposeId: 'diagnose-rendering',
          });
          expect(f.persisted()).toEqual(result);
          expect(f.tickets.create).toHaveBeenCalledTimes(1);
        } else {
          await expect(pending).rejects.toMatchObject({ status: 403 });
          expect(f.tickets.create).not.toHaveBeenCalled();
          expect(f.persisted()).toEqual(openTicket().toProps());
        }
        expect(f.access.authorize).toHaveBeenCalledWith({
          actorUserId: 'requester-1',
          organizationId: 'org-1',
          action: 'CREATE',
        });
        expect(f.tickets.findById).not.toHaveBeenCalled();
        expect(f.tickets.save).not.toHaveBeenCalled();
      },
    );

    it('keeps the captured invalid purpose even if the caller replaces it during authorization', async () => {
      const f = fixture();
      const authorization = deferred<boolean>();
      f.access.authorize.mockReturnValueOnce(authorization.promise);
      const input = { actorUserId: 'requester-1', organizationId: 'org-1', purposeId: '' };
      const pending = f.create.execute(input);
      input.purposeId = 'replacement';
      authorization.resolve(true);
      await expect(pending).rejects.toMatchObject({
        status: 400,
        response: { code: 'INVALID_SUPPORT_TICKET' },
      });
      expect(f.tickets.create).not.toHaveBeenCalled();
    });

    it('keeps create attribution while its repository write is pending', async () => {
      const f = fixture();
      const started = deferred<void>();
      const write = deferred<void>();
      const originalCreate = f.tickets.create.getMockImplementation()!;
      f.tickets.create.mockImplementationOnce(async (ticket) => {
        started.resolve(undefined);
        await write.promise;
        await originalCreate(ticket);
      });
      const input = {
        actorUserId: 'requester-1',
        organizationId: 'org-1',
        purposeId: 'diagnose-rendering',
      };
      const pending = f.create.execute(input);
      await started.promise;
      Object.assign(input, {
        actorUserId: 'other-user',
        organizationId: 'other-org',
        purposeId: 'other-purpose',
      });
      write.resolve(undefined);
      const result = await pending;
      expect(result).toMatchObject({
        requesterUserId: 'requester-1',
        organizationId: 'org-1',
        purposeId: 'diagnose-rendering',
      });
      expect(f.persisted()).toEqual(result);
      expect(f.tickets.findById).not.toHaveBeenCalled();
    });

    it.each([
      ['authorization', 'CLOSE'],
      ['authorization', 'CANCEL'],
      ['authorization', 'REOPEN'],
      ['lookup', 'CLOSE'],
      ['lookup', 'CANCEL'],
      ['lookup', 'REOPEN'],
    ] as const)('keeps all captured transition fields during %s for %s', async (phase, action) => {
      const f = fixture();
      if (action === 'REOPEN') await f.transition.execute(command);
      f.tickets.findById.mockClear();
      f.tickets.save.mockClear();
      f.access.authorize.mockClear();
      const resume = deferred<boolean>();
      const started = deferred<void>();
      if (phase === 'authorization') {
        f.access.authorize.mockImplementationOnce(() => {
          started.resolve(undefined);
          return resume.promise;
        });
      } else {
        const originalLookup = f.tickets.findById.getMockImplementation()!;
        f.tickets.findById.mockImplementationOnce(async (ticketId, organizationId) => {
          started.resolve(undefined);
          await resume.promise;
          return originalLookup(ticketId, organizationId);
        });
      }
      const original = { ...command, action, expectedRevision: action === 'REOPEN' ? 1 : 0 };
      const input = { ...original };
      const pending = f.transition.execute(input);
      await started.promise;
      Object.assign(input, {
        actorUserId: 'other-user',
        organizationId: 'other-org',
        ticketId: 'other-ticket',
        action: action === 'CLOSE' ? 'CANCEL' : 'CLOSE',
        expectedRevision: 999,
      });
      resume.resolve(true);
      const result = await pending;
      expect(f.access.authorize).toHaveBeenCalledWith({
        actorUserId: original.actorUserId,
        organizationId: original.organizationId,
        ticketId: original.ticketId,
        action,
      });
      expect(f.tickets.findById).toHaveBeenCalledTimes(1);
      expect(f.tickets.findById).toHaveBeenCalledWith(original.ticketId, original.organizationId);
      expect(f.tickets.save).toHaveBeenCalledWith(
        expect.any(SupportTicketEntity),
        original.expectedRevision,
      );
      expect(result).toMatchObject({
        ticketId: original.ticketId,
        organizationId: original.organizationId,
        requesterUserId: original.actorUserId,
        revision: original.expectedRevision + 1,
        status: action === 'REOPEN' ? 'OPEN' : action === 'CLOSE' ? 'CLOSED' : 'CANCELLED',
        decisionReferences: null,
      });
      const episode = result.episodes[result.episodes.length - 1];
      expect(action === 'REOPEN' ? episode.openedBy : episode.endedBy).toBe(original.actorUserId);
      expect(f.persisted()).toEqual(result);
    });

    it('cannot redirect an authorized close to an existing Ticket in another Organisation', async () => {
      const f = fixture();
      let other = SupportTicketEntity.fromPersistence({
        ...openTicket().toProps(),
        ticketId: 'other-ticket',
        organizationId: 'other-org',
        decisionReferences: null,
      }).toProps();
      const beforeOther = SupportTicketEntity.fromPersistence(other).toProps();
      const originalLookup = f.tickets.findById.getMockImplementation()!;
      const originalSave = f.tickets.save.getMockImplementation()!;
      f.tickets.findById.mockImplementation(async (ticketId, organizationId) =>
        ticketId === 'other-ticket' && organizationId === 'other-org'
          ? SupportTicketEntity.fromPersistence(other)
          : originalLookup(ticketId, organizationId),
      );
      f.tickets.save.mockImplementation(async (ticket, revision) => {
        if (ticket.toProps().organizationId === 'other-org') {
          other = ticket.toProps();
          return true;
        }
        return originalSave(ticket, revision);
      });
      const authorization = deferred<boolean>();
      f.access.authorize.mockReturnValueOnce(authorization.promise);
      const input = { ...command };
      const pending = f.transition.execute(input);
      Object.assign(input, {
        actorUserId: 'other-user',
        organizationId: 'other-org',
        ticketId: 'other-ticket',
        action: 'CANCEL',
      });
      authorization.resolve(true);
      const result = await pending;
      expect(result).toMatchObject({
        ticketId: command.ticketId,
        organizationId: command.organizationId,
        status: 'CLOSED',
      });
      expect(result.episodes[0].endedBy).toBe(command.actorUserId);
      expect(other).toEqual(beforeOther);
      expect(f.tickets.findById).not.toHaveBeenCalledWith('other-ticket', 'other-org');
    });

    it.each(['CLOSE', 'CANCEL', 'REOPEN'] as const)(
      'performs no writes when pending %s authorization denies after mutation',
      async (action) => {
        const f = fixture();
        const authorization = deferred<boolean>();
        f.access.authorize.mockReturnValueOnce(authorization.promise);
        const input = { ...command, action };
        const pending = f.transition.execute(input);
        Object.assign(input, {
          actorUserId: 'other-user',
          organizationId: 'other-org',
          ticketId: 'other-ticket',
          action: 'CANCEL',
          expectedRevision: 999,
        });
        authorization.resolve(false);
        await expect(pending).rejects.toMatchObject({ status: 403 });
        for (const method of Object.values(f.tickets)) expect(method).not.toHaveBeenCalled();
        expect(f.persisted()).toEqual(openTicket().toProps());
      },
    );
  });
});
