import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { LogPhoneCallService } from '../src/modules/leads/application/log-phone-call.service';
import { SendQuoteRepositories, SendQuoteUnitOfWork } from '../src/modules/leads/application/send-quote-unit-of-work.port';
import { LeadRecord, LeadRepository, LeadStatus, LeadSource, LeadPriority, LeadPhoneCallOutcome } from '../src/modules/leads/domain/lead.types';
import { AuditRepository } from '../src/modules/audit/domain/audit.repository';
import { AuthenticatedUser } from '../src/shared/logging/request-id.middleware';

describe('LogPhoneCallService (UC-60)', () => {
  const LEAD_ID = '6ad586fe9f2215c9ebcac858';
  const ACTOR_ID = '6a8d90b0569ea93e27ad862c';
  const REQUEST_ID = '8c5f0e16-58f3-49b6-941d-f1cb39c53afd';
  const actor: AuthenticatedUser = { userId: ACTOR_ID, email: 'sales@alsm.dev', isPlatformAdmin: false };
  const dto = {
    outcome: LeadPhoneCallOutcome.CONNECTED,
    durationMinutes: 12,
    summary: 'Discussed modernization scope',
    notes: 'Send the technical checklist',
  };
  let leads: jest.Mocked<LeadRepository>;
  let audit: jest.Mocked<AuditRepository>;
  let uow: jest.Mocked<SendQuoteUnitOfWork>;
  let service: LogPhoneCallService;

  const makeLead = (overrides: Partial<LeadRecord> = {}): LeadRecord => ({
    id: LEAD_ID,
    companyName: 'FPT Software',
    contactName: 'Cuong Nguyen',
    contactEmail: 'cuong@example.test',
    status: LeadStatus.NEW,
    source: LeadSource.WEBSITE,
    priority: LeadPriority.MEDIUM,
    currency: 'USD',
    tags: [],
    phoneCalls: [],
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
      claimEmailNotification: jest.fn(), completeEmailNotification: jest.fn(),
    };
    audit = { append: jest.fn().mockResolvedValue(undefined) };
    uow = { run: jest.fn() } as unknown as jest.Mocked<SendQuoteUnitOfWork>;
    uow.run.mockImplementation(async <T>(work: (repositories: SendQuoteRepositories) => Promise<T>) => work({ leads, audit }));
    service = new LogPhoneCallService(uow);
  });

  it('validates identifiers, idempotency key, required summary, and duration before opening a transaction', async () => {
    await expect(service.execute('bad-id', dto, actor, REQUEST_ID)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.execute(LEAD_ID, dto, actor, undefined)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.execute(LEAD_ID, { ...dto, summary: '  ' }, actor, REQUEST_ID)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.execute(LEAD_ID, { ...dto, durationMinutes: 0 }, actor, REQUEST_ID)).rejects.toBeInstanceOf(BadRequestException);
    expect(uow.run).not.toHaveBeenCalled();
  });

  it('saves the call, moves a new lead to Contacted, and audits without including call text', async () => {
    const lead = makeLead();
    const updatedLead = makeLead({ status: LeadStatus.CONTACTED });
    leads.findById.mockResolvedValue(lead);
    leads.addPhoneCallOnce.mockImplementation(async (_id, call) => {
      updatedLead.phoneCalls = [call];
      return updatedLead;
    });

    const result = await service.execute(LEAD_ID, dto, actor, REQUEST_ID);

    expect(result.replayed).toBe(false);
    expect(result.call.summary).toBe(dto.summary);
    expect(result.lead.status).toBe(LeadStatus.CONTACTED);
    expect(leads.addPhoneCallOnce).toHaveBeenCalledWith(
      LEAD_ID,
      expect.objectContaining({ requestId: REQUEST_ID, outcome: dto.outcome, performedByUserId: ACTOR_ID }),
      LeadStatus.NEW,
      LeadStatus.CONTACTED,
    );
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({
      action: 'LEAD_PHONE_CALL_LOGGED',
      resourceId: LEAD_ID,
      metadata: expect.not.objectContaining({ summary: dto.summary, notes: dto.notes }),
    }));
  });

  it('returns the prior call for an identical retry and rejects reuse with different details', async () => {
    const lead = makeLead();
    leads.findById.mockResolvedValue(lead);
    leads.addPhoneCallOnce.mockImplementation(async (_id, call) => makeLead({
      status: LeadStatus.CONTACTED,
      phoneCalls: [call],
    }));
    const first = await service.execute(LEAD_ID, dto, actor, REQUEST_ID);
    leads.findById.mockResolvedValue(makeLead({ status: LeadStatus.CONTACTED, phoneCalls: [first.call] }));

    await expect(service.execute(LEAD_ID, dto, actor, REQUEST_ID)).resolves.toMatchObject({ replayed: true, call: { id: first.call.id } });
    await expect(service.execute(LEAD_ID, { ...dto, summary: 'Different call' }, actor, REQUEST_ID)).rejects.toBeInstanceOf(ConflictException);
    expect(leads.addPhoneCallOnce).toHaveBeenCalledTimes(1);
    expect(audit.append).toHaveBeenCalledTimes(1);
  });

  it('does not write or audit when the lead does not exist', async () => {
    leads.findById.mockResolvedValue(null);
    await expect(service.execute(LEAD_ID, dto, actor, REQUEST_ID)).rejects.toBeInstanceOf(NotFoundException);
    expect(leads.addPhoneCallOnce).not.toHaveBeenCalled();
    expect(audit.append).not.toHaveBeenCalled();
  });
});
