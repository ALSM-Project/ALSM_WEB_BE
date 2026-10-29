import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ScheduleDemoService } from '../src/modules/leads/application/schedule-demo.service';
import { SendQuoteRepositories, SendQuoteUnitOfWork } from '../src/modules/leads/application/send-quote-unit-of-work.port';
import { LeadDemo, LeadRecord, LeadRepository, LeadSource, LeadPriority, LeadStatus, ScheduleDemoInput } from '../src/modules/leads/domain/lead.types';
import { AuditRepository } from '../src/modules/audit/domain/audit.repository';
import { AuthenticatedUser } from '../src/shared/logging/request-id.middleware';

describe('ScheduleDemoService (UC-61)', () => {
  const LEAD_ID = '6ad586fe9f2215c9ebcac858';
  const ACTOR_ID = '6a8d90b0569ea93e27ad862c';
  const REQUEST_ID = '8c5f0e16-58f3-49b6-941d-f1cb39c53afd';
  const actor: AuthenticatedUser = { userId: ACTOR_ID, email: 'sales@alsm.dev', isPlatformAdmin: false };
  const input: ScheduleDemoInput = {
    title: 'Modernization walkthrough',
    scheduledAt: '2027-01-20T15:00:00.000Z',
    durationMinutes: 45,
    attendeeEmails: ['cuong@example.test', 'architect@example.test'],
    agenda: 'Review modernization approach',
    internalNotes: 'Prepare a migration example',
  };
  let leads: jest.Mocked<LeadRepository>;
  let audit: jest.Mocked<AuditRepository>;
  let uow: jest.Mocked<SendQuoteUnitOfWork>;
  let service: ScheduleDemoService;

  const makeLead = (overrides: Partial<LeadRecord> = {}): LeadRecord => ({
    id: LEAD_ID,
    companyName: 'FPT Software',
    contactName: 'Cuong Nguyen',
    contactEmail: 'cuong@example.test',
    status: LeadStatus.NEW,
    source: LeadSource.WEBSITE,
    priority: LeadPriority.MEDIUM,
    currency: 'VND',
    tags: [],
    demos: [],
    createdByUserId: ACTOR_ID,
    createdByEmail: actor.email,
    createdAt: new Date('2026-10-20T00:00:00.000Z'),
    updatedAt: new Date('2026-10-20T00:00:00.000Z'),
    ...overrides,
  });

  beforeEach(() => {
    leads = {
      create: jest.fn(), findById: jest.fn(), list: jest.fn(), countByStatus: jest.fn(),
      updateStatus: jest.fn(), addQuote: jest.fn(), addQuoteOnce: jest.fn(), addPhoneCallOnce: jest.fn(),
      addDemoOnce: jest.fn(), claimEmailNotification: jest.fn(), completeEmailNotification: jest.fn(),
    };
    audit = { append: jest.fn().mockResolvedValue(undefined) };
    uow = { run: jest.fn() } as unknown as jest.Mocked<SendQuoteUnitOfWork>;
    uow.run.mockImplementation(async <T>(work: (repositories: SendQuoteRepositories) => Promise<T>) => work({ leads, audit }));
    service = new ScheduleDemoService(uow);
  });

  it('validates identifiers, idempotency, date, duration and attendees before opening a transaction', async () => {
    await expect(service.execute('bad-id', input, actor, REQUEST_ID)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.execute(LEAD_ID, input, actor, undefined)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.execute(LEAD_ID, { ...input, scheduledAt: 'yesterday' }, actor, REQUEST_ID)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.execute(LEAD_ID, { ...input, durationMinutes: 500 }, actor, REQUEST_ID)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.execute(LEAD_ID, { ...input, attendeeEmails: ['invalid'] }, actor, REQUEST_ID)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.execute(LEAD_ID, undefined as unknown as ScheduleDemoInput, actor, REQUEST_ID)).rejects.toBeInstanceOf(BadRequestException);
    expect(uow.run).not.toHaveBeenCalled();
  });

  it('saves and audits the demo, moves New to Qualified, and excludes private text and attendee addresses from audit', async () => {
    leads.findById.mockResolvedValue(makeLead());
    leads.addDemoOnce.mockImplementation(async (_id, demo, _expectedStatus, newStatus) => makeLead({
      status: newStatus,
      demos: [demo],
      lastContactedAt: demo.createdAt,
    }));

    const result = await service.execute(LEAD_ID, input, actor, REQUEST_ID);

    expect(result).toMatchObject({ replayed: false, message: 'Demo scheduled successfully.' });
    expect(result.demo.attendeeEmails).toEqual(input.attendeeEmails);
    expect(result.lead.status).toBe(LeadStatus.QUALIFIED);
    expect(leads.addDemoOnce).toHaveBeenCalledWith(
      LEAD_ID,
      expect.objectContaining({ requestId: REQUEST_ID, status: 'SCHEDULED', scheduledByUserId: ACTOR_ID }),
      LeadStatus.NEW,
      LeadStatus.QUALIFIED,
    );
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({
      action: 'LEAD_DEMO_SCHEDULED',
      resourceId: LEAD_ID,
      metadata: expect.not.objectContaining({
        attendeeEmails: input.attendeeEmails,
        agenda: input.agenda,
        internalNotes: input.internalNotes,
      }),
    }));
  });

  it('returns the original demo for an identical retry and rejects key reuse with different details', async () => {
    leads.findById.mockResolvedValue(makeLead());
    leads.addDemoOnce.mockImplementation(async (_id, demo) => makeLead({ status: LeadStatus.QUALIFIED, demos: [demo] }));
    const first = await service.execute(LEAD_ID, input, actor, REQUEST_ID);
    const persistedDemo = { ...first.demo } as LeadDemo;
    leads.findById.mockResolvedValue(makeLead({ status: LeadStatus.QUALIFIED, demos: [persistedDemo] }));

    await expect(service.execute(LEAD_ID, input, actor, REQUEST_ID)).resolves.toMatchObject({ replayed: true, demo: { id: first.demo.id } });
    await expect(service.execute(LEAD_ID, { ...input, title: 'Different demo title' }, actor, REQUEST_ID)).rejects.toBeInstanceOf(ConflictException);
    expect(leads.addDemoOnce).toHaveBeenCalledTimes(1);
    expect(audit.append).toHaveBeenCalledTimes(1);
  });

  it('does not persist when the lead is missing or closed', async () => {
    leads.findById.mockResolvedValue(null);
    await expect(service.execute(LEAD_ID, input, actor, REQUEST_ID)).rejects.toBeInstanceOf(NotFoundException);
    expect(leads.addDemoOnce).not.toHaveBeenCalled();

    leads.findById.mockResolvedValue(makeLead({ status: LeadStatus.WON }));
    await expect(service.execute(LEAD_ID, input, actor, REQUEST_ID)).rejects.toBeInstanceOf(BadRequestException);
    expect(leads.addDemoOnce).not.toHaveBeenCalled();
    expect(audit.append).not.toHaveBeenCalled();
  });

  it('propagates audit failures to the unit of work for transaction rollback', async () => {
    leads.findById.mockResolvedValue(makeLead());
    leads.addDemoOnce.mockImplementation(async (_id, demo, _expectedStatus, newStatus) => makeLead({ status: newStatus, demos: [demo] }));
    audit.append.mockRejectedValue(new Error('audit storage unavailable'));

    await expect(service.execute(LEAD_ID, input, actor, REQUEST_ID)).rejects.toThrow('audit storage unavailable');
    expect(leads.addDemoOnce).toHaveBeenCalledTimes(1);
  });
});
