import { GetSupportTicketService } from '../src/modules/support/application/get-support-ticket.service';
import { ListSupportTicketsService } from '../src/modules/support/application/list-support-tickets.service';
import { SupportTicketEntity } from '../src/modules/support/domain/support-ticket.entity';
import { newTicket, organizationId, requesterId } from './support-ticket.persistence.fixtures';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

describe('Support Ticket scoped reads', () => {
  const original = newTicket();
  const ticketId = original.toProps().ticketId;
  const command = { actorUserId: requesterId, organizationId, ticketId };
  const pageCommand = {
    actorUserId: requesterId,
    organizationId,
    limit: 1,
    afterTicketId: '00000000-0000-4000-8000-000000000001',
  };
  function fixture() {
    const tickets = {
      create: jest.fn(),
      save: jest.fn(),
      findById: jest.fn().mockResolvedValue(original),
      list: jest.fn().mockResolvedValue([]),
    };
    const access = { authorize: jest.fn().mockResolvedValue(true) };
    return {
      tickets,
      access,
      get: new GetSupportTicketService(tickets, access),
      list: new ListSupportTicketsService(tickets, access),
    };
  }
  it.each(['get', 'list'] as const)(
    'denies %s without an access provider before touching persistence',
    async (method) => {
      const f = fixture();
      const operation =
        method === 'get'
          ? new GetSupportTicketService(f.tickets).execute(command)
          : new ListSupportTicketsService(f.tickets).execute(pageCommand);
      await expect(operation).rejects.toMatchObject({ status: 403 });
      expect(f.tickets.findById).not.toHaveBeenCalled();
      expect(f.tickets.list).not.toHaveBeenCalled();
    },
  );
  it.each(['get', 'list'] as const)(
    'uses literal authorization for %s and propagates outages without reads',
    async (method) => {
      const f = fixture();
      f.access.authorize.mockResolvedValue('true' as never);
      await expect(
        method === 'get' ? f.get.execute(command) : f.list.execute(pageCommand),
      ).rejects.toMatchObject({ status: 403 });
      f.access.authorize.mockRejectedValue(new Error('authority down'));
      await expect(
        method === 'get' ? f.get.execute(command) : f.list.execute(pageCommand),
      ).rejects.toThrow('authority down');
      expect(f.tickets.findById).not.toHaveBeenCalled();
      expect(f.tickets.list).not.toHaveBeenCalled();
    },
  );
  it('keeps READ identity through delayed authorization and repository reads', async () => {
    const f = fixture();
    const authority = deferred<boolean>();
    const stored = deferred<SupportTicketEntity>();
    f.access.authorize.mockReturnValue(authority.promise);
    f.tickets.findById.mockReturnValue(stored.promise);
    const input = { ...command };
    const operation = f.get.execute(input);
    Object.assign(input, { actorUserId: 'forged', organizationId: 'foreign', ticketId: 'other' });
    authority.resolve(true);
    await Promise.resolve();
    await Promise.resolve();
    stored.resolve(original);
    expect(await operation).toEqual(original.toProps());
    expect(f.access.authorize).toHaveBeenCalledWith({ ...command, action: 'READ' });
    expect(f.tickets.findById).toHaveBeenCalledWith(ticketId, organizationId);
  });
  it('keeps LIST scope, bounds and cursor through delayed authorization', async () => {
    const f = fixture();
    const authority = deferred<boolean>();
    f.access.authorize.mockReturnValue(authority.promise);
    const input = { ...pageCommand };
    const operation = f.list.execute(input);
    Object.assign(input, {
      actorUserId: 'forged',
      organizationId: 'foreign',
      limit: 100000,
      afterTicketId: 'forged',
    });
    authority.resolve(true);
    expect(await operation).toEqual({ items: [], nextAfterTicketId: null });
    expect(f.access.authorize).toHaveBeenCalledWith({
      actorUserId: requesterId,
      organizationId,
      action: 'LIST',
    });
    expect(f.tickets.list).toHaveBeenCalledWith(organizationId, 1, pageCommand.afterTicketId);
  });
  it.each([-1, 0, 51, 1.2, Number.NaN, Infinity])(
    'rejects invalid page bound %s before authorization',
    async (limit) => {
      const f = fixture();
      await expect(f.list.execute({ ...pageCommand, limit })).rejects.toMatchObject({
        status: 400,
      });
      expect(f.access.authorize).not.toHaveBeenCalled();
      expect(f.tickets.list).not.toHaveBeenCalled();
    },
  );
  it('never discloses a foreign or misidentified READ adapter result', async () => {
    const f = fixture();
    for (const patch of [{ organizationId: 'foreign' }, { ticketId: 'another-ticket' }]) {
      f.tickets.findById.mockResolvedValue(
        SupportTicketEntity.fromPersistence({ ...original.toProps(), ...patch }),
      );
      await expect(f.get.execute(command)).rejects.toMatchObject({
        status: 404,
        response: { code: 'SUPPORT_TICKET_NOT_FOUND' },
      });
    }
  });
  it('rejects a foreign, unsorted or over-limit LIST result instead of returning any part', async () => {
    const f = fixture();
    const first = SupportTicketEntity.fromPersistence({
      ...original.toProps(),
      ticketId: '00000000-0000-4000-8000-000000000002',
    });
    const second = SupportTicketEntity.fromPersistence({
      ...original.toProps(),
      ticketId: '00000000-0000-4000-8000-000000000003',
    });
    const foreign = SupportTicketEntity.fromPersistence({
      ...first.toProps(),
      organizationId: 'foreign',
    });
    for (const results of [[foreign], [second, first], [first, second, second]]) {
      f.tickets.list.mockResolvedValue(results);
      await expect(f.list.execute(pageCommand)).rejects.toMatchObject({ status: 503 });
    }
  });
});
