import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Types } from 'mongoose';
import { PlatformAdminService } from '../src/modules/admin/application/platform-admin.service';

describe('[UC-75] Update Organisation Engagement Service', () => {
  type OrganizationFixture = {
    _id: Types.ObjectId;
    id: string;
    name: string;
    type: string;
    status: 'ACTIVE' | 'SUSPENDED' | 'TRIAL';
    engagementType: string;
    trialExpiresAt?: Date;
    limits: Record<string, number | boolean>;
    members: unknown[];
    createdAt: Date;
    updatedAt: Date;
    save: jest.Mock;
  };

  const organizationId = new Types.ObjectId().toString();
  const actorUserId = new Types.ObjectId().toString();
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
  let organization: OrganizationFixture;
  let findById: jest.Mock;
  let auditInTransaction: jest.Mock;
  let auditAppend: jest.Mock;
  let service: PlatformAdminService;

  beforeEach(() => {
    jest.clearAllMocks();
    organization = {
      _id: new Types.ObjectId(organizationId),
      id: organizationId,
      name: 'Apex Modernization Corp',
      type: 'ENTERPRISE',
      status: 'ACTIVE',
      engagementType: 'ENTERPRISE_T2',
      trialExpiresAt: new Date('2027-01-01T00:00:00.000Z'),
      limits: {
        maxScreens: 50,
        maxPrograms: 25,
        maxStorageGb: 100,
        maxProjects: 10,
        maxConversionsPerMonth: 100,
        aiValidationEnabled: true,
        trialScreens: 15,
        trialPrograms: 8,
        trialStorageGb: 5,
      },
      members: [],
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      save: jest.fn().mockResolvedValue(undefined),
    };
    findById = jest.fn(() => ({
      session: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(organization),
    }));
    auditAppend = jest.fn().mockResolvedValue(undefined);
    auditInTransaction = jest.fn(() => ({ append: auditAppend }));
    service = new PlatformAdminService(
      { findById, db: connection } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { append: jest.fn(), inTransaction: auditInTransaction } as never,
    );
    jest.spyOn(service, 'getOrganizationDetails').mockResolvedValue({ id: organizationId } as never);
  });

  it('validates and atomically persists status, engagement, expiry and supported limits with audit', async () => {
    const result = await service.updateOrganizationEngagement(actorUserId, organizationId, {
      status: 'TRIAL',
      engagementType: 'Enterprise Pilot',
      trialExpiresAt: '2027-06-30T00:00:00.000Z',
      limits: {
        maxProjects: 20,
        maxConversionsPerMonth: 250,
        maxStorageGb: 75.5,
        aiValidationEnabled: false,
        trialScreens: 30,
        trialPrograms: 12,
        trialStorageGb: 8.5,
      },
    });

    expect(organization.status).toBe('TRIAL');
    expect(organization.engagementType).toBe('Enterprise Pilot');
    expect(organization.trialExpiresAt?.toISOString()).toBe('2027-06-30T00:00:00.000Z');
    expect(organization.limits).toMatchObject({ maxProjects: 20, maxConversionsPerMonth: 250, maxStorageGb: 75.5, aiValidationEnabled: false, trialScreens: 30, trialPrograms: 12, trialStorageGb: 8.5 });
    expect(organization.save).toHaveBeenCalledWith({ session });
    expect(auditInTransaction).toHaveBeenCalledWith(session, connection);
    expect(auditAppend).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId,
      resourceId: organizationId,
      action: 'ORGANISATION_ENGAGEMENT_UPDATED',
      metadata: expect.objectContaining({
        changedFields: 'status,engagementType,trialExpiresAt,limits',
        status: 'TRIAL',
        engagementType: 'Enterprise Pilot',
      }),
    }));
    expect(result).toEqual({ id: organizationId });
  });

  it('does not write or duplicate audit when an identical update is retried', async () => {
    await service.updateOrganizationEngagement(actorUserId, organizationId, {
      status: 'ACTIVE',
      engagementType: 'ENTERPRISE_T2',
      trialExpiresAt: '2027-01-01T00:00:00.000Z',
      limits: {
        maxProjects: 10,
        maxConversionsPerMonth: 100,
        maxStorageGb: 100,
        aiValidationEnabled: true,
        trialScreens: 15,
        trialPrograms: 8,
        trialStorageGb: 5,
      },
    });

    expect(organization.save).not.toHaveBeenCalled();
    expect(auditAppend).not.toHaveBeenCalled();
  });

  it('rejects invalid IDs, empty updates, and out-of-range limits before opening a transaction', async () => {
    await expect(service.updateOrganizationEngagement(actorUserId, 'not-an-id', { status: 'ACTIVE' }))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(service.updateOrganizationEngagement(actorUserId, organizationId, {}))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(service.updateOrganizationEngagement(actorUserId, organizationId, { limits: { maxProjects: 0 } }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(connection.startSession).not.toHaveBeenCalled();
  });

  it('returns not found without writing when the organisation is missing', async () => {
    findById.mockReturnValue({ session: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue(null) });

    await expect(service.updateOrganizationEngagement(actorUserId, organizationId, { status: 'SUSPENDED' }))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(organization.save).not.toHaveBeenCalled();
    expect(auditAppend).not.toHaveBeenCalled();
  });

  it('aborts the transaction when the audit write fails', async () => {
    auditAppend.mockRejectedValue(new Error('audit store credentials must not be returned'));

    await expect(service.updateOrganizationEngagement(actorUserId, organizationId, { status: 'SUSPENDED' }))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(session.withTransaction).toHaveBeenCalled();
    expect(service.getOrganizationDetails).not.toHaveBeenCalled();
  });
});
