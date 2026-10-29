import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SendQuoteService } from '../src/modules/leads/application/send-quote.service';
import { SendQuoteRepositories, SendQuoteUnitOfWork } from '../src/modules/leads/application/send-quote-unit-of-work.port';
import { LeadRecord, LeadRepository, LeadStatus, LeadSource, LeadPriority } from '../src/modules/leads/domain/lead.types';
import { AuditRepository } from '../src/modules/audit/domain/audit.repository';
import { createHash } from 'crypto';
import { MongoLeadRepository } from '../src/modules/leads/infrastructure/mongo-lead.repository';

describe('SendQuoteService (UC-62)', () => {
  const VALID_ID = '6ad586fe9f2215c9ebcac858';
  const REQUEST_ID = '8c5f0e16-58f3-49b6-941d-f1cb39c53afd';
  let leads: jest.Mocked<LeadRepository>;
  let audit: jest.Mocked<AuditRepository>;
  let uow: jest.Mocked<SendQuoteUnitOfWork>;
  let service: SendQuoteService;

  const makeLead = (overrides: Partial<LeadRecord> = {}): LeadRecord => ({
    id: VALID_ID,
    companyName: 'FinTech Dynamics Corp',
    contactName: 'Sarah Jenkins',
    contactEmail: 's.jenkins@fintechdynamics.com',
    status: LeadStatus.QUALIFIED,
    source: LeadSource.WEBSITE,
    priority: LeadPriority.HIGH,
    currency: 'USD',
    tags: [],
    quotes: [],
    createdByUserId: '6a8d90b0569ea93e27ad862c',
    createdByEmail: 'sales@alsm.dev',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  const payload = (overrides = {}) => ({
    requestId: REQUEST_ID,
    planName: 'Enterprise Modernization',
    amount: 50000,
    ...overrides,
  });

  beforeEach(() => {
    leads = {
      create: jest.fn(), findById: jest.fn(), list: jest.fn(), countByStatus: jest.fn(),
      updateStatus: jest.fn(), addQuote: jest.fn(), addQuoteOnce: jest.fn(),
      addPhoneCallOnce: jest.fn(),
      addDemoOnce: jest.fn(),
      claimEmailNotification: jest.fn(), completeEmailNotification: jest.fn(),
    };
    audit = { append: jest.fn().mockResolvedValue(undefined) };
    uow = { run: jest.fn() } as unknown as jest.Mocked<SendQuoteUnitOfWork>;
    uow.run.mockImplementation(async <T>(work: (repositories: SendQuoteRepositories) => Promise<T>) =>
      work({ leads, audit }),
    );
    service = new SendQuoteService(uow);
  });

  it('rejects invalid IDs and obvious quote input errors before opening a transaction', async () => {
    await expect(service.execute('invalid', payload())).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.execute(VALID_ID, payload({ planName: ' ' }))).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.execute(VALID_ID, payload({ amount: Number.NaN }))).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.execute(VALID_ID, payload({ discountPercent: 20 }))).rejects.toBeInstanceOf(BadRequestException);
    expect(uow.run).not.toHaveBeenCalled();
  });

  it('returns not found and rejects terminal lead states without writing', async () => {
    leads.findById.mockResolvedValue(null);
    await expect(service.execute(VALID_ID, payload())).rejects.toBeInstanceOf(NotFoundException);
    leads.findById.mockResolvedValue(makeLead({ status: LeadStatus.LOST }));
    await expect(service.execute(VALID_ID, payload())).rejects.toBeInstanceOf(BadRequestException);
    expect(leads.addQuoteOnce).not.toHaveBeenCalled();
    expect(audit.append).not.toHaveBeenCalled();
  });

  it('creates quote, transitions lead, and audits within one unit of work', async () => {
    const lead = makeLead();
    const updatedLead = makeLead({ status: LeadStatus.PROPOSAL });
    leads.findById.mockResolvedValue(lead);
    leads.addQuoteOnce.mockImplementation(async (_id, quote) => {
      updatedLead.quotes = [quote];
      return updatedLead;
    });

    const result = await service.execute(VALID_ID, payload({ discountPercent: 10, recipientEmail: 'BUYER@example.com' }));

    expect(result.quote.status).toBe('SENT');
    expect(result.quote.amount).toBe(45000);
    expect(result.quote.recipientEmail).toBe('buyer@example.com');
    expect(result.lead.status).toBe(LeadStatus.PROPOSAL);
    expect(leads.addQuoteOnce).toHaveBeenCalledWith(VALID_ID, expect.objectContaining({ requestId: REQUEST_ID }), LeadStatus.QUALIFIED, LeadStatus.PROPOSAL);
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({ action: 'LEAD_QUOTE_SENT', resourceId: VALID_ID }));
  });

  it('replays the same request without creating another quote or audit record', async () => {
    const requestFingerprint = createHash('sha256').update(JSON.stringify({ planName: 'Enterprise Modernization', amount: 50000, discountPercent: 0, validityDays: 30 })).digest('hex');
    const quote = { id: 'q1', requestId: REQUEST_ID, requestFingerprint, quoteNumber: 'QT-2026-12345', planName: 'Enterprise Modernization', amount: 50000, status: 'SENT' as const, createdAt: new Date() };
    const lead = makeLead({ quotes: [quote] });
    leads.findById.mockResolvedValue(lead);
    // Hash is deterministic for the exact normalized input used below.
    const result = await service.execute(VALID_ID, payload());
    expect(result.quote.id).toBe('q1');
    expect(leads.addQuoteOnce).not.toHaveBeenCalled();
    expect(audit.append).not.toHaveBeenCalled();
  });

  it('returns the committed quote for a concurrent retry with the same request and contents', async () => {
    const lead = makeLead();
    const requestFingerprint = createHash('sha256').update(JSON.stringify({ planName: 'Enterprise Modernization', amount: 50000, discountPercent: 0, validityDays: 30 })).digest('hex');
    const committed = { id: 'q1', requestId: REQUEST_ID, requestFingerprint, quoteNumber: 'QT-2026-12345', planName: 'Enterprise Modernization', amount: 50000, status: 'SENT' as const, createdAt: new Date() };
    leads.findById.mockResolvedValueOnce(lead).mockResolvedValueOnce(makeLead({ quotes: [committed] }));
    leads.addQuoteOnce.mockResolvedValue(null);
    await expect(service.execute(VALID_ID, payload())).resolves.toMatchObject({ quote: { id: 'q1' } });
    expect(audit.append).not.toHaveBeenCalled();
  });
});

describe('MongoLeadRepository legacy CRM document mapping', () => {
  it('maps CRM-shaped leads that do not have UC-58 creator fields', () => {
    const repository = new MongoLeadRepository({} as never);
    const crmLead = {
      id: '6ad586fe9f2215c9ebcac858',
      company: 'FinTech Dynamics Corp',
      contactName: 'Sarah Jenkins',
      contactEmail: 's.jenkins@fintechdynamics.com',
      phone: '+1 (555) 234-5678',
      stage: 'QUALIFIED',
      source: 'Website',
      assignments: [],
      quotes: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mapped = (repository as unknown as { map(doc: unknown): LeadRecord }).map(crmLead);
    expect(mapped).toMatchObject({
      companyName: 'FinTech Dynamics Corp',
      contactName: 'Sarah Jenkins',
      contactEmail: 's.jenkins@fintechdynamics.com',
      status: LeadStatus.QUALIFIED,
      source: LeadSource.WEBSITE,
      priority: LeadPriority.MEDIUM,
      createdByUserId: undefined,
    });
  });
});
