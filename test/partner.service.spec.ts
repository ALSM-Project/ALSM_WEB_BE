import { BadRequestException, ConflictException } from '@nestjs/common';
import { CreatePartnerService } from '../src/modules/partners/application/create-partner.service';
import { ListPartnersService } from '../src/modules/partners/application/list-partners.service';
import { PartnerRepository, PartnerStatus } from '../src/modules/partners/domain/partner.types';
import { AuditRepository } from '../src/modules/audit/domain/audit.repository';

describe('CreatePartnerService (UC-44)', () => {
  let partners: jest.Mocked<PartnerRepository>;
  let audit: jest.Mocked<AuditRepository>;
  let service: CreatePartnerService;

  beforeEach(() => {
    partners = {
      findByEmail: jest.fn(),
      create: jest.fn(),
      list: jest.fn(),
    } as unknown as jest.Mocked<PartnerRepository>;
    audit = { append: jest.fn() } as unknown as jest.Mocked<AuditRepository>;
    service = new CreatePartnerService(partners, audit);
  });

  it('rejects a missing partner name', async () => {
    await expect(
      service.execute('staff-1', { name: '  ', contactEmail: 'partner@vendor.com' }),
    ).rejects.toThrow(BadRequestException);
    expect(partners.create).not.toHaveBeenCalled();
  });

  it('rejects an invalid contact email', async () => {
    await expect(
      service.execute('staff-1', { name: 'Acme Vendor', contactEmail: 'not-an-email' }),
    ).rejects.toThrow(BadRequestException);
    expect(partners.create).not.toHaveBeenCalled();
  });

  it('rejects a duplicate contact email with a real 409, not a silent overwrite', async () => {
    partners.findByEmail.mockResolvedValue({
      id: 'partner-1',
      name: 'Existing Partner',
      contactEmail: 'partner@vendor.com',
      status: PartnerStatus.ACTIVE,
      createdBy: 'staff-0',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(
      service.execute('staff-1', { name: 'Acme Vendor', contactEmail: 'partner@vendor.com' }),
    ).rejects.toThrow(ConflictException);
    expect(partners.create).not.toHaveBeenCalled();
  });

  it('creates a real partner record and writes a real audit entry', async () => {
    partners.findByEmail.mockResolvedValue(null);
    partners.create.mockResolvedValue({
      id: 'partner-1',
      name: 'Acme Vendor',
      contactEmail: 'partner@vendor.com',
      status: PartnerStatus.ACTIVE,
      createdBy: 'staff-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.execute('staff-1', {
      name: '  Acme Vendor  ',
      contactEmail: 'Partner@Vendor.com',
      contactPhone: '+1 555 0100',
    });

    expect(partners.create).toHaveBeenCalledWith({
      name: 'Acme Vendor',
      contactEmail: 'partner@vendor.com',
      contactPhone: '+1 555 0100',
      website: undefined,
      address: undefined,
      notes: undefined,
      createdBy: 'staff-1',
    });
    expect(audit.append).toHaveBeenCalledWith({
      actorUserId: 'staff-1',
      action: 'PARTNER_CREATED',
      resourceType: 'PARTNER',
      resourceId: 'partner-1',
    });
    expect(result.id).toBe('partner-1');
  });

  it('does not write an audit entry if creation fails', async () => {
    partners.findByEmail.mockResolvedValue(null);
    partners.create.mockRejectedValue(new Error('storage unavailable'));

    await expect(
      service.execute('staff-1', { name: 'Acme Vendor', contactEmail: 'partner@vendor.com' }),
    ).rejects.toThrow('storage unavailable');
    expect(audit.append).not.toHaveBeenCalled();
  });
});

describe('ListPartnersService (UC-44)', () => {
  it('returns the real partner list from the repository', async () => {
    const partners: jest.Mocked<PartnerRepository> = {
      findByEmail: jest.fn(),
      create: jest.fn(),
      list: jest.fn().mockResolvedValue([
        {
          id: 'partner-1',
          name: 'Acme Vendor',
          contactEmail: 'partner@vendor.com',
          status: PartnerStatus.ACTIVE,
          createdBy: 'staff-1',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]),
    } as unknown as jest.Mocked<PartnerRepository>;

    const service = new ListPartnersService(partners);
    const result = await service.execute();

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Acme Vendor');
  });
});
