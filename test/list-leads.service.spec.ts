import { ListLeadsService } from '../src/modules/leads/application/list-leads.service';
import {
  LeadRepository,
  LeadStatus,
  LeadSource,
  LeadPriority,
  LeadRecord,
} from '../src/modules/leads/domain/lead.types';

describe('ListLeadsService (UC-58)', () => {
  let repository: jest.Mocked<LeadRepository>;
  let service: ListLeadsService;

  const mockLead: LeadRecord = {
    id: '6ad586fe9f2215c9ebcac858',
    companyName: 'FinTech Dynamics Corp',
    contactName: 'Sarah Jenkins',
    contactEmail: 's.jenkins@fintechdynamics.com',
    contactPhone: '+1 (555) 234-5678',
    jobTitle: 'VP of Engineering',
    status: LeadStatus.QUALIFIED,
    source: LeadSource.WEBSITE,
    priority: LeadPriority.HIGH,
    estimatedValue: 120000,
    currency: 'USD',
    notes: 'Looking to modernize AS400 core banking screens.',
    assignedToUserId: '6a8d90b0569ea93e27ad862c',
    assignedToEmail: 'test.local@alsm.dev',
    tags: ['Banking', 'AS400'],
    createdByUserId: '6a8d90b0569ea93e27ad862c',
    createdByEmail: 'test.local@alsm.dev',
    createdAt: new Date('2026-10-16T00:00:00.000Z'),
    updatedAt: new Date('2026-10-24T00:00:00.000Z'),
  };

  beforeEach(() => {
    repository = {
      create: jest.fn(),
      findById: jest.fn(),
      list: jest.fn().mockResolvedValue({ items: [mockLead], total: 1 }),
      countByStatus: jest.fn().mockResolvedValue({
        [LeadStatus.QUALIFIED]: 1,
        [LeadStatus.NEW]: 0,
        [LeadStatus.WON]: 0,
      }),
      updateStatus: jest.fn(),
      addQuote: jest.fn(),
    };
    service = new ListLeadsService(repository);
  });


  it('lists leads with pagination and status counts', async () => {
    const result = await service.execute({ page: 1, limit: 10 });

    expect(repository.list).toHaveBeenCalledWith({ page: 1, limit: 10 });
    expect(repository.countByStatus).toHaveBeenCalled();
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.items[0].companyName).toBe('FinTech Dynamics Corp');
    expect(result.statusCounts[LeadStatus.QUALIFIED]).toBe(1);
  });

  it('filters leads by status, source, and priority', async () => {
    await service.execute({
      status: LeadStatus.QUALIFIED,
      source: LeadSource.WEBSITE,
      priority: LeadPriority.HIGH,
      search: 'FinTech',
    });

    expect(repository.list).toHaveBeenCalledWith({
      status: LeadStatus.QUALIFIED,
      source: LeadSource.WEBSITE,
      priority: LeadPriority.HIGH,
      search: 'FinTech',
    });
  });

  it('handles empty results gracefully', async () => {
    repository.list.mockResolvedValueOnce({ items: [], total: 0 });
    repository.countByStatus.mockResolvedValueOnce({});

    const result = await service.execute({ search: 'NonExistent' });

    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(result.statusCounts).toEqual({});
  });
});
