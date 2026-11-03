import { BadRequestException, ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { PlatformAdminService } from '../src/modules/admin/application/platform-admin.service';

describe('[UC-74] Create New Enterprise Organisation Service', () => {
  const actorId = new Types.ObjectId().toString();
  const userId = new Types.ObjectId();
  const organizationId = new Types.ObjectId();
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
  const query = (value: unknown) => ({
    session: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  });
  type TestOrgModel = {
    db: typeof connection;
    findOne: jest.Mock;
    create: jest.Mock;
    updateOne: jest.Mock;
  };
  let service: PlatformAdminService;
  let orgModel: TestOrgModel;
  let userModel: Record<string, jest.Mock>;
  let roleAssignment: jest.Mock;
  let auditAppend: jest.Mock;
  let inviteSend: jest.Mock;
  let createdOrg: Record<string, unknown>;

  beforeEach(() => {
    jest.clearAllMocks();
    createdOrg = { _id: organizationId, id: organizationId.toString(), initialAdminInviteStatus: 'PENDING' };
    orgModel = {
      db: connection,
      findOne: jest.fn().mockReturnValue(query(null)),
      create: jest.fn().mockResolvedValue([createdOrg]),
      updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) }),
    };
    userModel = {
      findOne: jest.fn().mockReturnValue(query(null)),
      create: jest.fn().mockResolvedValue([{ _id: userId, email: 'owner@example.com', isEmailVerified: false }]),
    };
    roleAssignment = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ upsertedCount: 1 }) });
    auditAppend = jest.fn().mockResolvedValue(undefined);
    inviteSend = jest.fn().mockResolvedValue(undefined);
    service = new PlatformAdminService(
      orgModel as never,
      userModel as never,
      {} as never,
      { findOne: jest.fn().mockReturnValue(query({ trialLimits: { maxScreens: 40, maxPrograms: 20, maxStorageGb: 8 } })) } as never,
      {} as never,
      {} as never,
      {} as never,
      { append: jest.fn(), inTransaction: jest.fn(() => ({ append: auditAppend })) } as never,
      { create: jest.fn().mockResolvedValue([{ tokenHash: 'hashed-token' }]) } as never,
      { findOne: jest.fn().mockReturnValue(query({ id: 'ENTERPRISE_MEMBER' })) } as never,
      { updateOne: roleAssignment } as never,
      { send: inviteSend } as never,
    );
    jest.spyOn(service, 'getOrganizationDetails').mockResolvedValue({ id: organizationId.toString() } as never);
  });

  it('atomically creates the enterprise, administrator membership, one-time invite and audit entry', async () => {
    const previousSmtpHost = process.env.SMTP_HOST;
    const previousSmtpUser = process.env.SMTP_USER;
    process.env.SMTP_HOST = 'smtp.example.test';
    process.env.SMTP_USER = 'mailer@example.test';
    try {
      const result = await service.createEnterpriseOrganization(actorId, {
        name: '  Apex   Enterprise  ',
        contactEmail: 'OWNER@EXAMPLE.COM',
        engagementType: 'Enterprise Pilot',
        trialDays: 45,
        maxScreens: 70,
        requestId: 'b286dd90-fba3-4ead-a8c5-c2ac88c1b2cb',
      });

      expect(result).toMatchObject({ invitationStatus: 'SENT', replayed: false });
      expect(orgModel.create).toHaveBeenCalledWith([expect.objectContaining({
        name: 'Apex Enterprise',
        normalizedName: 'apex enterprise',
        contactEmail: 'owner@example.com',
        type: 'ENTERPRISE',
        status: 'TRIAL',
        engagementType: 'Enterprise Pilot',
        limits: { maxScreens: 70, maxPrograms: 20, maxStorageGb: 8 },
        members: [{ userId, role: 'ADMIN' }],
        initialAdminInviteStatus: 'PENDING',
      })], { session });
      expect(userModel.create).toHaveBeenCalledWith([expect.objectContaining({ isEmailVerified: false, mustChangePassword: true })], { session });
      expect(roleAssignment).toHaveBeenCalledWith(
        { userId: userId.toString(), roleId: 'ENTERPRISE_MEMBER' },
        { $setOnInsert: { userId: userId.toString(), roleId: 'ENTERPRISE_MEMBER' } },
        { upsert: true, session },
      );
      expect(auditAppend).toHaveBeenCalledWith(expect.objectContaining({ action: 'ENTERPRISE_ORGANIZATION_CREATED' }));
      expect(inviteSend).toHaveBeenCalledWith(expect.objectContaining({ to: 'owner@example.com' }));
      expect(JSON.stringify(inviteSend.mock.calls)).not.toContain('hashed-token');
      expect(orgModel.updateOne).toHaveBeenCalledWith(
        { _id: organizationId },
        { $set: { initialAdminInviteStatus: 'SENT' } },
      );
    } finally {
      if (previousSmtpHost === undefined) delete process.env.SMTP_HOST;
      else process.env.SMTP_HOST = previousSmtpHost;
      if (previousSmtpUser === undefined) delete process.env.SMTP_USER;
      else process.env.SMTP_USER = previousSmtpUser;
    }
  });

  it('rejects invalid actor IDs and duplicate organisation names before creating records', async () => {
    await expect(service.createEnterpriseOrganization('not-an-object-id', {
      name: 'Apex Enterprise', contactEmail: 'owner@example.com', engagementType: 'Enterprise Pilot',
    })).rejects.toBeInstanceOf(BadRequestException);

    orgModel.findOne.mockReturnValueOnce(query(null)).mockReturnValueOnce(query(null)).mockReturnValueOnce(query({ id: 'duplicate' }));
    await expect(service.createEnterpriseOrganization(actorId, {
      name: 'Apex Enterprise', contactEmail: 'owner@example.com', engagementType: 'Enterprise Pilot',
      requestId: 'b286dd90-fba3-4ead-a8c5-c2ac88c1b2cb',
    })).rejects.toBeInstanceOf(ConflictException);
    expect(orgModel.create).not.toHaveBeenCalled();
    expect(userModel.create).not.toHaveBeenCalled();
  });
});
