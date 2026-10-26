import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UpdateLeadStatusService } from '../src/modules/leads/application/update-lead-status.service';
import {
  LeadRepository,
  LeadStatus,
  LeadSource,
  LeadPriority,
  LeadRecord,
} from '../src/modules/leads/domain/lead.types';
import { AuditRepository } from '../src/modules/audit/domain/audit.repository';
import { AuthenticatedUser } from '../src/shared/logging/request-id.middleware';

describe('UpdateLeadStatusService (UC-66)', () => {
  let repository: jest.Mocked<LeadRepository>;
  let audit: jest.Mocked<AuditRepository>;
  let service: UpdateLeadStatusService;

  const VALID_ID = '6ad586fe9f2215c9ebcac858';
  const actor: AuthenticatedUser = {
    userId: '6a8d90b0569ea93e27ad862c',
    email: 'sales@alsm.dev',
    isPlatformAdmin: false,
  };

  const makeLead = (overrides: Partial<LeadRecord> = {}): LeadRecord => ({
    id: VALID_ID,
    companyName: 'FinTech Dynamics Corp',
    contactName: 'Sarah Jenkins',
    contactEmail: 's.jenkins@fintechdynamics.com',
    contactPhone: '+1 (555) 234-5678',
    jobTitle: 'VP of Engineering',
    status: LeadStatus.NEW,
    source: LeadSource.WEBSITE,
    priority: LeadPriority.HIGH,
    estimatedValue: 120000,
    currency: 'USD',
    notes: undefined,
    assignedToUserId: undefined,
    assignedToEmail: undefined,
    tags: ['Banking'],
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
    };
    audit = { append: jest.fn().mockResolvedValue(undefined) };
    service = new UpdateLeadStatusService(repository, audit);
  });

  describe('successful status transitions', () => {
    it('transitions from NEW to CONTACTED and writes audit log', async () => {
      const lead = makeLead({ status: LeadStatus.NEW });
      const updated = makeLead({ status: LeadStatus.CONTACTED });
      repository.findById.mockResolvedValue(lead);
      repository.updateStatus.mockResolvedValue(updated);

      const result = await service.execute(VALID_ID, LeadStatus.CONTACTED, undefined, actor);

      expect(repository.updateStatus).toHaveBeenCalledWith(
        VALID_ID,
        LeadStatus.CONTACTED,
        expect.objectContaining({ lastContactedAt: expect.any(Date) }),
      );
      expect(audit.append).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'LEAD_STATUS_UPDATED',
          resourceType: 'LEAD',
          resourceId: updated.id,
          metadata: expect.objectContaining({
            previousStatus: LeadStatus.NEW,
            newStatus: LeadStatus.CONTACTED,
          }),
        }),
      );
      expect(result.updated).toBe(true);
      expect(result.lead.status).toBe(LeadStatus.CONTACTED);
    });

    it('transitions from QUALIFIED to PROPOSAL with notes', async () => {
      const lead = makeLead({ status: LeadStatus.QUALIFIED });
      const updated = makeLead({ status: LeadStatus.PROPOSAL, notes: 'Sent proposal doc' });
      repository.findById.mockResolvedValue(lead);
      repository.updateStatus.mockResolvedValue(updated);

      const result = await service.execute(
        VALID_ID,
        LeadStatus.PROPOSAL,
        'Sent proposal doc',
        actor,
      );

      expect(repository.updateStatus).toHaveBeenCalledWith(
        VALID_ID,
        LeadStatus.PROPOSAL,
        expect.objectContaining({ notes: 'Sent proposal doc' }),
      );
      expect(result.updated).toBe(true);
    });

    it('transitions NEGOTIATION to WON successfully', async () => {
      const lead = makeLead({ status: LeadStatus.NEGOTIATION });
      const updated = makeLead({ status: LeadStatus.WON });
      repository.findById.mockResolvedValue(lead);
      repository.updateStatus.mockResolvedValue(updated);

      const result = await service.execute(VALID_ID, LeadStatus.WON, undefined, actor);

      expect(result.updated).toBe(true);
      expect(result.lead.status).toBe(LeadStatus.WON);
    });
  });

  describe('idempotency – same status', () => {
    it('returns current lead without updating when status matches', async () => {
      const lead = makeLead({ status: LeadStatus.QUALIFIED });
      repository.findById.mockResolvedValue(lead);

      const result = await service.execute(VALID_ID, LeadStatus.QUALIFIED, undefined, actor);

      expect(repository.updateStatus).not.toHaveBeenCalled();
      expect(audit.append).not.toHaveBeenCalled();
      expect(result.updated).toBe(false);
      expect(result.message).toContain('already in QUALIFIED');
    });

    it('updates notes even when status is unchanged', async () => {
      const lead = makeLead({ status: LeadStatus.QUALIFIED, notes: 'old note' });
      const updated = makeLead({ status: LeadStatus.QUALIFIED, notes: 'new note' });
      repository.findById.mockResolvedValue(lead);
      repository.updateStatus.mockResolvedValue(updated);

      const result = await service.execute(
        VALID_ID,
        LeadStatus.QUALIFIED,
        'new note',
        actor,
      );

      expect(repository.updateStatus).toHaveBeenCalledWith(
        VALID_ID,
        LeadStatus.QUALIFIED,
        expect.objectContaining({ notes: 'new note' }),
      );
      expect(result.updated).toBe(true);
    });
  });

  describe('validation errors', () => {
    it('throws INVALID_LEAD_ID for malformed id', async () => {
      await expect(
        service.execute('not-valid-id', LeadStatus.CONTACTED, undefined, actor),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws INVALID_STATUS for unknown status value', async () => {
      await expect(
        service.execute(VALID_ID, 'UNKNOWN' as LeadStatus, undefined, actor),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws LEAD_NOT_FOUND when lead does not exist', async () => {
      repository.findById.mockResolvedValue(null);
      await expect(
        service.execute(VALID_ID, LeadStatus.CONTACTED, undefined, actor),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws INVALID_STATUS_TRANSITION for NEW → WON (not allowed)', async () => {
      repository.findById.mockResolvedValue(makeLead({ status: LeadStatus.NEW }));

      await expect(
        service.execute(VALID_ID, LeadStatus.WON, undefined, actor),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws INVALID_STATUS_TRANSITION for WON → NEW (not directly allowed)', async () => {
      repository.findById.mockResolvedValue(makeLead({ status: LeadStatus.WON }));

      await expect(
        service.execute(VALID_ID, LeadStatus.NEW, undefined, actor),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws INVALID_STATUS_TRANSITION for WON → CONTACTED (not allowed)', async () => {
      repository.findById.mockResolvedValue(makeLead({ status: LeadStatus.WON }));

      await expect(
        service.execute(VALID_ID, LeadStatus.CONTACTED, undefined, actor),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('allowed transition coverage', () => {
    const cases: [LeadStatus, LeadStatus][] = [
      [LeadStatus.NEW, LeadStatus.CONTACTED],
      [LeadStatus.NEW, LeadStatus.QUALIFIED],
      [LeadStatus.NEW, LeadStatus.LOST],
      [LeadStatus.CONTACTED, LeadStatus.QUALIFIED],
      [LeadStatus.CONTACTED, LeadStatus.PROPOSAL],
      [LeadStatus.CONTACTED, LeadStatus.LOST],
      [LeadStatus.QUALIFIED, LeadStatus.PROPOSAL],
      [LeadStatus.QUALIFIED, LeadStatus.NEGOTIATION],
      [LeadStatus.QUALIFIED, LeadStatus.LOST],
      [LeadStatus.PROPOSAL, LeadStatus.NEGOTIATION],
      [LeadStatus.PROPOSAL, LeadStatus.WON],
      [LeadStatus.PROPOSAL, LeadStatus.LOST],
      [LeadStatus.NEGOTIATION, LeadStatus.WON],
      [LeadStatus.NEGOTIATION, LeadStatus.LOST],
      [LeadStatus.WON, LeadStatus.NEGOTIATION],
      [LeadStatus.WON, LeadStatus.LOST],
      [LeadStatus.LOST, LeadStatus.NEW],
    ];

    test.each(cases)(
      'allows transition from %s to %s',
      async (from, to) => {
        const lead = makeLead({ status: from });
        const updated = makeLead({ status: to });
        repository.findById.mockResolvedValue(lead);
        repository.updateStatus.mockResolvedValue(updated);

        const result = await service.execute(VALID_ID, to, undefined, actor);
        expect(result.updated).toBe(true);
      },
    );
  });
});
