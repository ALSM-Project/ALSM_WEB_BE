import { Model, Types } from 'mongoose';
import { MongoSupportTicketRepository } from '../src/modules/support/infrastructure/mongo-support-ticket.repository';
import { supportTicketToSnapshot } from '../src/modules/support/infrastructure/support-ticket.mapper';
import { SupportTicket } from '../src/modules/support/infrastructure/support-ticket.schema';
import { newTicket, organizationId } from './support-ticket.persistence.fixtures';

describe('Mongo Support Ticket bounded scoped listing', () => {
  function fixture() {
    const original = newTicket();
    const query = { sort: jest.fn(), limit: jest.fn(), lean: jest.fn(), exec: jest.fn() };
    query.sort.mockReturnValue(query);
    query.limit.mockReturnValue(query);
    query.lean.mockReturnValue(query);
    query.exec.mockResolvedValue([supportTicketToSnapshot(original)]);
    const model = { find: jest.fn().mockReturnValue(query) };
    const audit = jest.fn();
    return {
      original,
      model,
      query,
      audit,
      repo: new MongoSupportTicketRepository(model as unknown as Model<SupportTicket>, audit),
    };
  }
  it('requires exact BSON Organisation scope and bounds lookahead in Mongo before materializing', async () => {
    const f = fixture();
    const after = '00000000-0000-4000-8000-000000000001';
    const results = await f.repo.list(organizationId, 50, after);
    expect(f.model.find).toHaveBeenCalledWith({
      organizationId: new Types.ObjectId(organizationId),
      _id: { $gt: after },
    });
    expect(f.query.sort).toHaveBeenCalledWith({ _id: 1 });
    expect(f.query.limit).toHaveBeenCalledWith(51);
    expect(f.query.lean).toHaveBeenCalledTimes(1);
    expect(results[0].toProps()).toEqual(f.original.toProps());
    expect(f.audit).not.toHaveBeenCalled();
  });
  it('has no unscoped initial-page query', async () => {
    const f = fixture();
    await f.repo.list(organizationId, 1);
    expect(f.model.find).toHaveBeenCalledWith({
      organizationId: new Types.ObjectId(organizationId),
    });
    expect(f.query.limit).toHaveBeenCalledWith(2);
  });
  it.each([0, -1, 51, 0.1, Infinity, NaN])(
    'rejects invalid bounds %s before issuing a query',
    async (limit) => {
      const f = fixture();
      await expect(f.repo.list(organizationId, limit)).rejects.toThrow();
      expect(f.model.find).not.toHaveBeenCalled();
    },
  );
  it.each(['', 'slug', 'A'.repeat(24)])(
    'rejects noncanonical Organisation %s without slug fallback',
    async (organization) => {
      const f = fixture();
      await expect(f.repo.list(organization, 1)).rejects.toThrow();
      expect(f.model.find).not.toHaveBeenCalled();
    },
  );
  it('rejects corrupt history without repairing defaults or returning partial data', async () => {
    const f = fixture();
    f.query.exec.mockResolvedValue([{ ...supportTicketToSnapshot(newTicket()), episodes: [] }]);
    await expect(f.repo.list(organizationId, 1)).rejects.toMatchObject({
      status: 503,
      response: { code: 'SUPPORT_TICKET_SNAPSHOT_INVALID' },
    });
    expect(f.audit).not.toHaveBeenCalled();
  });
});
