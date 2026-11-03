import { BadRequestException, ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { PlatformAdminService } from '../src/modules/admin/application/platform-admin.service';

describe('[UC-77] Create New Engagement Type Service', () => {
  const actorId = new Types.ObjectId().toString();
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
      select: jest.fn().mockReturnThis(),
      session: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(value),
    };
    return chain;
  };
  const input = {
    name: '  Premium   Modernization ',
    code: 'premium_modernization',
    description: 'Enterprise conversion package',
    price: 35000,
    trialLimits: { maxScreens: 15, maxPrograms: 8, maxStorageGb: 5 },
    usageLimits: { maxScreens: 250, maxPrograms: 100, maxStorageGb: 75 },
    features: ['BMS conversion', 'COBOL validation'],
    includesCobolConversion: true,
    supportTier: 'PREMIER',
    slaHours: 4,
    requestId: 'b286dd90-fba3-4ead-a8c5-c2ac88c1b2cb',
  };
  let service: PlatformAdminService;
  let findOne: jest.Mock;
  let create: jest.Mock;
  let auditAppend: jest.Mock;
  let auditInTransaction: jest.Mock;
  let createdRecord: Record<string, unknown> & {
    _id: Types.ObjectId;
    id: string;
    toObject: () => Record<string, unknown>;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    createdRecord = {
      _id: new Types.ObjectId(),
      id: '',
      toObject() { return this; },
    };
    createdRecord.id = createdRecord._id.toString();
    findOne = jest.fn().mockReturnValue(query(null));
    create = jest.fn().mockImplementation(async ([record]) => {
      Object.assign(createdRecord, record);
      return [createdRecord];
    });
    auditAppend = jest.fn().mockResolvedValue(undefined);
    auditInTransaction = jest.fn(() => ({ append: auditAppend }));
    service = new PlatformAdminService(
      {} as never,
      {} as never,
      {} as never,
      { db: connection, findOne, find: jest.fn().mockReturnValue(query([])), create } as never,
      {} as never,
      {} as never,
      {} as never,
      { append: jest.fn(), inTransaction: auditInTransaction } as never,
    );
  });

  it('validates actor and persists the type with normalized identifiers and audit in one transaction', async () => {
    const result = await service.createEngagementType(actorId, input);

    expect(result.replayed).toBe(false);
    expect(result.engagementType).toMatchObject({
      id: createdRecord.id,
      name: 'Premium Modernization',
      code: 'PREMIUM_MODERNIZATION',
      price: 35000,
      trialLimits: input.trialLimits,
      usageLimits: input.usageLimits,
      features: input.features,
      includesCobolConversion: true,
      supportTier: 'PREMIER',
      slaHours: 4,
      isActive: true,
    });
    expect(create).toHaveBeenCalledWith([expect.objectContaining({
      normalizedName: 'premium modernization',
      code: 'PREMIUM_MODERNIZATION',
      provisioningRequestId: input.requestId,
    })], { session });
    expect(auditInTransaction).toHaveBeenCalledWith(session, connection);
    expect(auditAppend).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: actorId,
      action: 'ENGAGEMENT_TYPE_CREATED',
      resourceId: createdRecord.id,
      metadata: expect.objectContaining({ code: 'PREMIUM_MODERNIZATION', name: 'Premium Modernization' }),
    }));
  });

  it('replays a completed request without creating or auditing a second engagement type', async () => {
    await service.createEngagementType(actorId, input);
    findOne.mockReturnValueOnce(query(createdRecord));

    const retry = await service.createEngagementType(actorId, input);

    expect(retry.replayed).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
    expect(auditAppend).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid actor and duplicate name without creating a record', async () => {
    await expect(service.createEngagementType('invalid', input)).rejects.toBeInstanceOf(BadRequestException);
    findOne.mockReturnValueOnce(query(null)).mockReturnValueOnce(query(null)).mockReturnValueOnce(query({ id: 'existing' }));

    await expect(service.createEngagementType(actorId, input)).rejects.toBeInstanceOf(ConflictException);
    expect(create).not.toHaveBeenCalled();
    expect(auditAppend).not.toHaveBeenCalled();
  });
});
