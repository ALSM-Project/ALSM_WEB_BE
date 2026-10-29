import { GUARDS_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Model, Types } from 'mongoose';
import { AuditRepository } from '../src/modules/audit/domain/audit.repository';
import { SalesCrmService } from '../src/modules/crm/application/sales-crm.service';
import { Organization } from '../src/modules/organizations/infrastructure/organization.schema';
import { Lead } from '../src/modules/crm/infrastructure/lead.schema';
import { User } from '../src/modules/users/infrastructure/user.schema';
import { PermissionsGuard } from '../src/shared/security/permissions.guard';
import { JwtAuthGuard } from '../src/shared/security/jwt-auth.guard';
import { PERMISSIONS_KEY } from '../src/shared/security/require-permissions.decorator';
import { SalesCrmController } from '../src/modules/crm/presentation/sales-crm.controller';
import { SalesPipelineQueryDto } from '../src/modules/crm/presentation/sales-pipeline-query.dto';

describe('UC-65 View Sales Pipeline', () => {
  const assignedUserId = new Types.ObjectId('6a8d90b0569ea93e27ad862c');
  const leadFindQuery = {
    select: jest.fn(),
    sort: jest.fn(),
    lean: jest.fn(),
    exec: jest.fn(),
  };
  const userFindQuery = {
    select: jest.fn(),
    lean: jest.fn(),
    exec: jest.fn(),
  };
  const leadModel = {
    find: jest.fn(),
  } as unknown as Model<Lead>;
  const userModel = {
    find: jest.fn(),
  } as unknown as Model<User>;
  const audit = { append: jest.fn() } as unknown as AuditRepository;
  let service: SalesCrmService;

  beforeEach(() => {
    jest.clearAllMocks();
    leadFindQuery.select.mockReturnThis();
    leadFindQuery.sort.mockReturnThis();
    leadFindQuery.lean.mockReturnThis();
    userFindQuery.select.mockReturnThis();
    userFindQuery.lean.mockReturnThis();
    (leadModel.find as jest.Mock).mockReturnValue(leadFindQuery);
    (userModel.find as jest.Mock).mockReturnValue(userFindQuery);
    service = new SalesCrmService(
      leadModel,
      {} as Model<Organization>,
      userModel,
      audit,
    );
  });

  it('requires an authenticated user with sales.leads.view permission', () => {
    const method = SalesCrmController.prototype.getSalesPipeline;
    expect(Reflect.getMetadata(PERMISSIONS_KEY, method)).toEqual(['sales.leads.view']);
    expect(Reflect.getMetadata(GUARDS_METADATA, method)).toContain(PermissionsGuard);
    expect(Reflect.getMetadata(GUARDS_METADATA, SalesCrmController)).toContain(JwtAuthGuard);
  });

  it('validates stage and search query input', async () => {
    const invalidQuery = plainToInstance(SalesPipelineQueryDto, {
      stage: 'ARCHIVED',
      search: 'x'.repeat(121),
    });
    const errors = await validate(invalidQuery);
    const invalidFields = errors.map((error) => error.property);
    expect(invalidFields).toEqual(expect.arrayContaining(['stage', 'search']));
  });

  it('returns normalized real leads, stage counts, and salesperson names without writing', async () => {
    const firstLeadId = new Types.ObjectId('6ad586fe9f2215c9ebcac858');
    const secondLeadId = new Types.ObjectId('6ad586fe9f2215c9ebcac859');
    const createdAt = new Date('2026-10-20T00:00:00.000Z');
    leadFindQuery.exec.mockResolvedValue([
      {
        _id: firstLeadId,
        companyName: 'Apex Health Systems',
        contactName: 'Dr. Michael Chang',
        status: 'NEGOTIATION',
        estimatedValue: 250000,
        currency: 'VND',
        assignedToUserId: assignedUserId,
        createdAt,
      },
      {
        _id: secondLeadId,
        company: 'Pacific Retail Group',
        contactName: 'David Tanaka',
        stage: 'WON',
        dealValue: 180000,
      },
    ]);
    userFindQuery.exec.mockResolvedValue([{ _id: assignedUserId, fullName: 'Lê Văn Sales' }]);

    const result = await service.getSalesPipeline();

    expect(result.total).toBe(2);
    expect(result.items[0]).toEqual(expect.objectContaining({
      id: firstLeadId.toString(),
      company: 'Apex Health Systems',
      stage: 'NEGOTIATION',
      dealValue: 250000,
      assignedToName: 'Lê Văn Sales',
    }));
    expect(result.items[1]).toEqual(expect.objectContaining({
      id: secondLeadId.toString(),
      company: 'Pacific Retail Group',
      stage: 'WON',
      dealValue: 180000,
    }));
    expect(result.stageCounts.NEGOTIATION).toBe(1);
    expect(result.stageCounts.WON).toBe(1);
    expect(audit.append).not.toHaveBeenCalled();
  });

  it('rejects an invalid organization identifier instead of removing the organization filter', async () => {
    await expect(service.getSalesPipeline({ organizationId: 'not-an-object-id' }))
      .rejects.toMatchObject({ response: expect.objectContaining({ code: 'INVALID_ORGANIZATION_ID' }) });
    expect(leadModel.find).not.toHaveBeenCalled();
  });
});
