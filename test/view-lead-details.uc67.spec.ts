import { BadRequestException, NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ListLeadsService } from '../src/modules/leads/application/list-leads.service';
import { LeadRepository, LeadRecord, LeadStatus, LeadSource, LeadPriority } from '../src/modules/leads/domain/lead.types';
import { LeadController } from '../src/modules/leads/presentation/lead.controller';
import { JwtAuthGuard } from '../src/shared/security/jwt-auth.guard';
import { PermissionsGuard } from '../src/shared/security/permissions.guard';
import { PERMISSIONS_KEY } from '../src/shared/security/require-permissions.decorator';

describe('View Lead Details (UC-67)', () => {
  const validId = '64b000000000000000000010';
  const lead: LeadRecord = {
    id: validId,
    companyName: 'Example Bank',
    contactName: 'Alex Smith',
    contactEmail: 'alex@example.test',
    status: LeadStatus.QUALIFIED,
    source: LeadSource.REFERRAL,
    priority: LeadPriority.HIGH,
    currency: 'USD',
    notes: 'Interested in modernization',
    tags: ['Banking'],
    createdByUserId: '64b000000000000000000001',
    createdByEmail: 'sales@example.test',
    createdAt: new Date('2026-10-29T00:00:00.000Z'),
    updatedAt: new Date('2026-10-29T00:00:00.000Z'),
  };
  let repository: jest.Mocked<Pick<LeadRepository, 'findById'>>;
  let service: ListLeadsService;

  beforeEach(() => {
    repository = { findById: jest.fn() };
    service = new ListLeadsService(repository as unknown as LeadRepository);
  });

  it('returns the requested lead details without changing data', async () => {
    repository.findById.mockResolvedValue(lead);

    await expect(service.findById(validId)).resolves.toBe(lead);
    expect(repository.findById).toHaveBeenCalledWith(validId);
  });

  it('returns a validation error for malformed lead identifiers before database access', async () => {
    await expect(service.findById('not-an-object-id')).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.findById).not.toHaveBeenCalled();
  });

  it('returns a not-found error when the lead does not exist', async () => {
    repository.findById.mockResolvedValue(null);

    await expect(service.findById(validId)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('requires authentication and sales.leads.view permission', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, LeadController.prototype.getById)).toEqual([
      'sales.leads.view',
    ]);
    expect(Reflect.getMetadata(GUARDS_METADATA, LeadController)).toEqual([
      JwtAuthGuard,
      PermissionsGuard,
    ]);
  });
});
