import { MongoLeadRepository } from '../src/modules/leads/infrastructure/mongo-lead.repository';
import { LeadStatus } from '../src/modules/leads/domain/lead.types';

describe('MongoLeadRepository lead status persistence', () => {
  it('updates the schema-backed status field and returns it as the current status', async () => {
    const id = '64b000000000000000000010';
    const document = {
      _id: id,
      // Legacy stage data must not override the canonical status field.
      stage: LeadStatus.NEW,
      status: LeadStatus.CONTACTED,
      companyName: 'Example Bank',
      contactName: 'Alex Smith',
      contactEmail: 'alex@example.test',
      source: 'WEBSITE',
      priority: 'MEDIUM',
      tags: [],
      quotes: [],
      createdAt: new Date('2026-10-29T00:00:00.000Z'),
      updatedAt: new Date('2026-10-29T00:00:00.000Z'),
    };
    const findByIdAndUpdate = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(document),
    });
    const repository = new MongoLeadRepository({ findByIdAndUpdate } as never);

    const updated = await repository.updateStatus(id, LeadStatus.CONTACTED);

    expect(findByIdAndUpdate).toHaveBeenCalledWith(
      id,
      { $set: expect.objectContaining({ status: LeadStatus.CONTACTED }) },
      { new: true, session: null },
    );
    const update = findByIdAndUpdate.mock.calls[0][1] as {
      $set: Record<string, unknown>;
    };
    expect(update.$set.stage).toBeUndefined();
    expect(updated?.status).toBe(LeadStatus.CONTACTED);
  });
});
