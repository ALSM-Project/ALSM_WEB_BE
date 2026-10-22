import { BadRequestException, ConflictException, HttpException } from '@nestjs/common';
import { CreatePartnerService } from '../src/modules/partners/application/create-partner.service';
import { ListPartnersService } from '../src/modules/partners/application/list-partners.service';
import {
  DuplicatePartnerEmailError,
  PartnerRecord,
  PartnerRepository,
  PartnerStatus,
} from '../src/modules/partners/domain/partner.types';
import { PartnerController } from '../src/modules/partners/presentation/partner.controller';
import { PERMISSIONS_KEY } from '../src/shared/security/require-permissions.decorator';
import { AuditRepository } from '../src/modules/audit/domain/audit.repository';

const USER_ID = '64b7f0c2a1b2c3d4e5f60718';

function partnerRecord(overrides: Partial<PartnerRecord> = {}): PartnerRecord {
  return {
    id: 'partner-1',
    name: 'Pacific Banking Systems Ltd.',
    contactEmail: 'jreynolds@pacificbanking.com',
    contactName: 'Jonathan Reynolds',
    primaryDomain: 'pacificbanking.com',
    engagementType: 'Dedicated Modernization',
    assignedStaffName: 'Sarah Jenkins',
    status: PartnerStatus.ACTIVE,
    createdBy: USER_ID,
    createdAt: new Date('2026-10-22T00:00:00Z'),
    updatedAt: new Date('2026-10-22T00:00:00Z'),
    ...overrides,
  };
}

const validRequest = {
  name: 'Pacific Banking Systems Ltd.',
  contactEmail: 'jreynolds@pacificbanking.com',
  contactName: 'Jonathan Reynolds',
  primaryDomain: 'pacificbanking.com',
  engagementType: 'Dedicated Modernization',
  assignedStaffName: 'Sarah Jenkins',
};

function errorBody(error: unknown): { code?: string; message?: string } {
  return (error as HttpException).getResponse() as { code?: string; message?: string };
}

describe('Partners (UC-44 Create Partner Profile)', () => {
  let partners: jest.Mocked<PartnerRepository>;
  let audit: jest.Mocked<AuditRepository>;
  let service: CreatePartnerService;

  beforeEach(() => {
    partners = {
      findByEmail: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(async (input) => partnerRecord({ ...input })),
      list: jest.fn().mockResolvedValue([]),
    };
    audit = { append: jest.fn().mockResolvedValue(undefined) };
    service = new CreatePartnerService(partners, audit);
  });

  async function expectRejected(request: Record<string, unknown>, type: unknown, code: string) {
    const error = await service
      .execute(USER_ID, request as typeof validRequest)
      .then(() => undefined)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(type as never);
    expect(errorBody(error).code).toBe(code);
    expect(partners.create).not.toHaveBeenCalled();
    expect(audit.append).not.toHaveBeenCalled();
  }

  // TC01
  it('rejects a missing partner name with 400 PARTNER_NAME_REQUIRED', async () => {
    await expectRejected(
      { ...validRequest, name: undefined },
      BadRequestException,
      'PARTNER_NAME_REQUIRED',
    );
  });

  // TC02
  it('rejects a whitespace-only partner name with 400 PARTNER_NAME_REQUIRED', async () => {
    await expectRejected(
      { ...validRequest, name: '    ' },
      BadRequestException,
      'PARTNER_NAME_REQUIRED',
    );
  });

  // TC03
  it('rejects a partner name longer than 200 characters with 400', async () => {
    await expectRejected(
      { ...validRequest, name: 'A'.repeat(201) },
      BadRequestException,
      'PARTNER_NAME_REQUIRED',
    );
  });

  // TC04
  it('rejects a malformed contact email with 400 INVALID_CONTACT_EMAIL', async () => {
    await expectRejected(
      { ...validRequest, contactEmail: 'not-an-email' },
      BadRequestException,
      'INVALID_CONTACT_EMAIL',
    );
  });

  // TC05
  it('rejects a missing contact email with 400 INVALID_CONTACT_EMAIL', async () => {
    await expectRejected(
      { ...validRequest, contactEmail: '' },
      BadRequestException,
      'INVALID_CONTACT_EMAIL',
    );
  });

  // TC06
  it('rejects a missing contact name or an invalid primary domain with 400', async () => {
    await expectRejected(
      { ...validRequest, contactName: ' ' },
      BadRequestException,
      'CONTACT_NAME_REQUIRED',
    );
    await expectRejected(
      { ...validRequest, primaryDomain: 'not a domain' },
      BadRequestException,
      'INVALID_PRIMARY_DOMAIN',
    );
  });

  // TC07
  it('rejects a duplicate contact email (case-insensitive) with 409 PARTNER_ALREADY_EXISTS', async () => {
    partners.findByEmail.mockResolvedValue(partnerRecord());
    const error = await service
      .execute(USER_ID, { ...validRequest, contactEmail: '  JReynolds@PacificBanking.COM ' })
      .catch((e: unknown) => e);

    expect(partners.findByEmail).toHaveBeenCalledWith('jreynolds@pacificbanking.com');
    expect(error).toBeInstanceOf(ConflictException);
    expect(errorBody(error)).toEqual({
      code: 'PARTNER_ALREADY_EXISTS',
      message: "A partner with contact email 'jreynolds@pacificbanking.com' already exists",
    });
    expect(partners.create).not.toHaveBeenCalled();
    expect(audit.append).not.toHaveBeenCalled();
  });

  // TC08
  it('returns 409 when a concurrent duplicate is caught by the unique index, without auditing', async () => {
    partners.create.mockRejectedValue(new DuplicatePartnerEmailError(validRequest.contactEmail));
    const error = await service.execute(USER_ID, validRequest).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect(errorBody(error).code).toBe('PARTNER_ALREADY_EXISTS');
    expect(audit.append).not.toHaveBeenCalled();
  });

  // TC09
  it('saves a valid partner with the name trimmed and the email lower-cased', async () => {
    const result = await service.execute(USER_ID, {
      ...validRequest,
      name: '   Pacific Banking Systems Ltd.   ',
      contactEmail: '  JReynolds@PacificBanking.COM  ',
      primaryDomain: 'PacificBanking.com',
    });

    expect(partners.create).toHaveBeenCalledWith({
      name: 'Pacific Banking Systems Ltd.',
      contactEmail: 'jreynolds@pacificbanking.com',
      contactName: 'Jonathan Reynolds',
      primaryDomain: 'pacificbanking.com',
      engagementType: 'Dedicated Modernization',
      assignedStaffName: 'Sarah Jenkins',
      createdBy: USER_ID,
    });
    expect(result.name).toBe('Pacific Banking Systems Ltd.');
    expect(result.contactEmail).toBe('jreynolds@pacificbanking.com');
  });

  // TC10
  it('writes a PARTNER_CREATED audit entry for the created partner', async () => {
    partners.create.mockResolvedValue(partnerRecord({ id: 'partner-42' }));
    await service.execute(USER_ID, validRequest);

    expect(audit.append).toHaveBeenCalledTimes(1);
    expect(audit.append).toHaveBeenCalledWith({
      actorUserId: USER_ID,
      action: 'PARTNER_CREATED',
      resourceType: 'PARTNER',
      resourceId: 'partner-42',
    });
  });

  // TC11
  it('does not write an audit entry when persisting the partner fails', async () => {
    partners.create.mockRejectedValue(new Error('database unavailable'));

    await expect(service.execute(USER_ID, validRequest)).rejects.toThrow('database unavailable');
    expect(audit.append).not.toHaveBeenCalled();
  });

  // TC12
  it('lists partners newest first and passes status/search filters through', async () => {
    const newest = partnerRecord({ id: 'p-new', createdAt: new Date('2026-10-22') });
    const older = partnerRecord({ id: 'p-old', createdAt: new Date('2026-10-01') });
    partners.list.mockResolvedValue([newest, older]);

    const result = await new ListPartnersService(partners).execute({
      status: PartnerStatus.ACTIVE,
      search: 'pacific',
    });

    expect(partners.list).toHaveBeenCalledWith({ status: PartnerStatus.ACTIVE, search: 'pacific' });
    expect(result.map((p) => p.id)).toEqual(['p-new', 'p-old']);
  });

  describe('PartnerController RBAC', () => {
    it('requires partner.create for POST /partners and partner.view for GET /partners', () => {
      const proto = PartnerController.prototype;
      expect(Reflect.getMetadata(PERMISSIONS_KEY, proto.create)).toEqual(['partner.create']);
      expect(Reflect.getMetadata(PERMISSIONS_KEY, proto.list)).toEqual(['partner.view']);
    });
  });
});
