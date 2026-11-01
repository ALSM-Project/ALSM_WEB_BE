import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { PlatformAdminService } from '../src/modules/admin/application/platform-admin.service';

describe('[UC-78] Edit Engagement Type Service', () => {
  const actorId = new Types.ObjectId().toString();
  const engagementTypeId = new Types.ObjectId().toString();
  const session = {
    hasEnded: false,
    explicit: true,
    transaction: {},
    inTransaction: jest.fn(() => true),
    withTransaction: jest.fn(async (work: () => Promise<unknown>) => work()),
    endSession: jest.fn().mockResolvedValue(undefined),
  };
  const connection = {
    db: { admin: () => ({ command: jest.fn().mockResolvedValue({ setName: 'rs0' }) }) },
    startSession: jest.fn().mockResolvedValue(session),
  };
  const query = (value: unknown) => {
    const chain = {
      session: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(value),
    };
    return chain;
  };
  type EngagementTypeFixture = Record<string, unknown> & {
    _id: Types.ObjectId;
    name: string;
    normalizedName: string;
    code: string;
    description: string;
    price: number;
    trialLimits: { maxScreens: number; maxPrograms: number; maxStorageGb: number };
    usageLimits: { maxScreens: number; maxPrograms: number; maxStorageGb: number };
    features: string[];
    includesCobolConversion: boolean;
    supportTier: string;
    slaHours: number;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    save: jest.Mock;
  };
  let service: PlatformAdminService;
  let record: EngagementTypeFixture;
  let findById: jest.Mock;
  let findOne: jest.Mock;
  let find: jest.Mock;
  let auditAppend: jest.Mock;
  let auditInTransaction: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    record = {
      _id: new Types.ObjectId(engagementTypeId),
      name: 'Enterprise Pilot',
      normalizedName: 'enterprise pilot',
      code: 'ENTERPRISE_PILOT',
      description: 'Current description',
      price: 15000,
      trialLimits: { maxScreens: 50, maxPrograms: 25, maxStorageGb: 10 },
      usageLimits: { maxScreens: 100, maxPrograms: 50, maxStorageGb: 25 },
      features: ['BMS conversion'],
      includesCobolConversion: true,
      supportTier: 'STANDARD_ENTERPRISE',
      slaHours: 12,
      isActive: true,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      save: jest.fn().mockResolvedValue(undefined),
    };
    findById = jest.fn().mockReturnValue(query(record));
    findOne = jest.fn().mockReturnValue(query(null));
    find = jest.fn().mockReturnValue(query([]));
    auditAppend = jest.fn().mockResolvedValue(undefined);
    auditInTransaction = jest.fn(() => ({ append: auditAppend }));
    service = new PlatformAdminService(
      {} as never,
      {} as never,
      {} as never,
      { db: connection, findById, findOne, find } as never,
      {} as never,
      {} as never,
      {} as never,
      { append: jest.fn(), inTransaction: auditInTransaction } as never,
    );
  });

  it('validates and transactionally updates plan values with one audit event', async () => {
    const result = await service.editEngagementType(actorId, engagementTypeId, {
      name: 'Enterprise Pilot Plus',
      code: 'ENTERPRISE_PILOT_PLUS',
      description: 'Updated description',
      price: 22000,
      trialLimits: { maxScreens: 60, maxPrograms: 30, maxStorageGb: 12 },
      usageLimits: { maxScreens: 180, maxPrograms: 90, maxStorageGb: 40 },
      features: ['BMS conversion', 'COBOL validation'],
      includesCobolConversion: true,
      supportTier: 'PREMIER',
      slaHours: 4,
    });

    expect(record).toMatchObject({
      name: 'Enterprise Pilot Plus',
      normalizedName: 'enterprise pilot plus',
      code: 'ENTERPRISE_PILOT_PLUS',
      description: 'Updated description',
      price: 22000,
      trialLimits: { maxScreens: 60, maxPrograms: 30, maxStorageGb: 12 },
      usageLimits: { maxScreens: 180, maxPrograms: 90, maxStorageGb: 40 },
      features: ['BMS conversion', 'COBOL validation'],
      supportTier: 'PREMIER',
      slaHours: 4,
    });
    expect(record.save).toHaveBeenCalledWith({ session });
    expect(auditInTransaction).toHaveBeenCalledWith(session, connection);
    expect(auditAppend).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: actorId,
      action: 'ENGAGEMENT_TYPE_UPDATED',
      resourceId: engagementTypeId,
      metadata: expect.objectContaining({ name: 'Enterprise Pilot Plus', code: 'ENTERPRISE_PILOT_PLUS' }),
    }));
    expect(result).toMatchObject({ id: engagementTypeId, name: 'Enterprise Pilot Plus', price: 22000 });
  });

  it('rejects invalid identifiers and empty updates before database reads', async () => {
    await expect(service.editEngagementType(actorId, 'bad-id', { price: 22000 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.editEngagementType(actorId, engagementTypeId, {})).rejects.toBeInstanceOf(BadRequestException);
    expect(findById).not.toHaveBeenCalled();
  });

  it('returns not found and refuses a conflicting code without saving or auditing', async () => {
    findById.mockReturnValueOnce(query(null));
    await expect(service.editEngagementType(actorId, engagementTypeId, { price: 22000 })).rejects.toBeInstanceOf(NotFoundException);

    findOne.mockReturnValueOnce(query({ id: 'other-plan' }));
    await expect(service.editEngagementType(actorId, engagementTypeId, { code: 'OTHER_PLAN' })).rejects.toBeInstanceOf(ConflictException);
    expect(record.save).not.toHaveBeenCalled();
    expect(auditAppend).not.toHaveBeenCalled();
  });

  it('does not write or audit when submitted values are unchanged', async () => {
    const result = await service.editEngagementType(actorId, engagementTypeId, { price: 15000 });
    expect(result.price).toBe(15000);
    expect(record.save).not.toHaveBeenCalled();
    expect(auditAppend).not.toHaveBeenCalled();
  });
});
