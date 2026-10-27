import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SendQuoteService } from '../src/modules/leads/application/send-quote.service';
import {
  LeadRepository,
  LeadStatus,
  LeadSource,
  LeadPriority,
  LeadRecord,
} from '../src/modules/leads/domain/lead.types';
import { AuditRepository } from '../src/modules/audit/domain/audit.repository';
import { AuthenticatedUser } from '../src/shared/logging/request-id.middleware';

describe('SendQuoteService (UC-62)', () => {
  let repository: jest.Mocked<LeadRepository>;
  let audit: jest.Mocked<AuditRepository>;
  let service: SendQuoteService;

  const VALID_ID = '6ad586fe9f2215c9ebcac858';
  const actor: AuthenticatedUser = {
    userId: '6a8d90b0569ea93e27ad862c',
    email: 'internal_sales@alsm.dev',
    isPlatformAdmin: false,
  };

  const makeLead = (overrides: Partial<LeadRecord> = {}): LeadRecord => ({
    id: VALID_ID,
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
    tags: ['Banking'],
    quotes: [],
    createdByUserId: '6a8d90b0569ea93e27ad862c',
    createdByEmail: 'sales@alsm.dev',
    createdAt: new Date('2026-10-16T00:00:00.000Z'),
    updatedAt: new Date('2026-10-24T00:00:00.000Z'),
    ...overrides,
  });

  beforeEach(() => {
    repository = {
      create: jest.fn(),
      findById: jest.fn(),
      list: jest.fn(),
      countByStatus: jest.fn(),
      updateStatus: jest.fn(),
      addQuote: jest.fn(),
    };
    audit = { append: jest.fn().mockResolvedValue(undefined) };
    service = new SendQuoteService(repository, audit);
  });

  describe('input validation', () => {
    it('throws BadRequestException for invalid lead id format', async () => {
      await expect(
        service.execute('invalid-id', {
          planName: 'Enterprise Modernization',
          amount: 50000,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for empty plan name', async () => {
      await expect(
        service.execute(VALID_ID, {
          planName: '   ',
          amount: 50000,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for non-positive amount', async () => {
      await expect(
        service.execute(VALID_ID, {
          planName: 'Enterprise Modernization',
          amount: 0,
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.execute(VALID_ID, {
          planName: 'Enterprise Modernization',
          amount: -100,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for invalid discount percentage', async () => {
      await expect(
        service.execute(VALID_ID, {
          planName: 'Enterprise Modernization',
          amount: 50000,
          discountPercent: 120,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException if discount > 15% without reason', async () => {
      await expect(
        service.execute(VALID_ID, {
          planName: 'Enterprise Modernization',
          amount: 50000,
          discountPercent: 20,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('business constraint checks', () => {
    it('throws NotFoundException when lead is not found', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(
        service.execute(VALID_ID, {
          planName: 'Enterprise Modernization',
          amount: 50000,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when lead status is LOST', async () => {
      repository.findById.mockResolvedValue(makeLead({ status: LeadStatus.LOST }));

      await expect(
        service.execute(VALID_ID, {
          planName: 'Enterprise Modernization',
          amount: 50000,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when lead status is WON', async () => {
      repository.findById.mockResolvedValue(makeLead({ status: LeadStatus.WON }));

      await expect(
        service.execute(VALID_ID, {
          planName: 'Enterprise Modernization',
          amount: 50000,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('successful quote generation & delivery', () => {
    it('generates quote with status SENT, transitions lead to PROPOSAL, and audits action', async () => {
      const existingLead = makeLead({ status: LeadStatus.QUALIFIED });
      repository.findById.mockResolvedValue(existingLead);

      const updatedLead = {
        ...existingLead,
        status: LeadStatus.PROPOSAL,
      };
      repository.addQuote.mockResolvedValue(updatedLead);

      const result = await service.execute(
        VALID_ID,
        {
          planName: 'Cloud Migration & Modernization',
          projectScope: 'Cobol to Java 100k LOC',
          amount: 60000,
          discountPercent: 10,
          validityDays: 45,
        },
        actor,
      );

      expect(result.quote).toBeDefined();
      expect(result.quote.planName).toBe('Cloud Migration & Modernization');
      expect(result.quote.amount).toBe(54000); // 60000 - 10%
      expect(result.quote.status).toBe('SENT');
      expect(result.quote.discountApproved).toBe(true);
      expect(result.quote.quoteNumber).toMatch(/^QT-\d{4}-\d{5}$/);
      expect(result.lead.status).toBe(LeadStatus.PROPOSAL);

      // Verify repository was called with PROPOSAL status transition
      expect(repository.addQuote).toHaveBeenCalledWith(
        VALID_ID,
        expect.objectContaining({
          amount: 54000,
          status: 'SENT',
        }),
        LeadStatus.PROPOSAL,
      );

      // Verify audit was logged
      expect(audit.append).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'LEAD_QUOTE_SENT',
          resourceType: 'LEAD',
          resourceId: VALID_ID,
          actorUserId: actor.userId,
        }),
      );
    });

    it('creates quote with PENDING_APPROVAL when discount > 15% with valid reason', async () => {
      const existingLead = makeLead({ status: LeadStatus.CONTACTED });
      repository.findById.mockResolvedValue(existingLead);

      repository.addQuote.mockResolvedValue({
        ...existingLead,
      });

      const result = await service.execute(
        VALID_ID,
        {
          planName: 'Enterprise Transformation',
          amount: 100000,
          discountPercent: 20,
          discountReason: 'Multi-year strategic partnership agreement',
        },
        actor,
      );

      expect(result.quote.status).toBe('PENDING_APPROVAL');
      expect(result.quote.discountApproved).toBe(false);
      expect(result.quote.amount).toBe(80000);
      expect(result.message).toContain('submitted for discount approval');

      // Lead status should NOT change to PROPOSAL before approval
      expect(repository.addQuote).toHaveBeenCalledWith(
        VALID_ID,
        expect.objectContaining({
          status: 'PENDING_APPROVAL',
        }),
        undefined,
      );
    });
  });
});
