import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { TemporaryRoleService } from '../src/modules/rbac/application/temporary-role.service';
import { EffectivePermissionsService } from '../src/modules/rbac/application/effective-permissions.service';

const exec = <T>(value: T) => ({ exec: jest.fn().mockResolvedValue(value) });
const REASON = 'Urgent batch migration needed for production issue';

describe('UC-95 Request Temporary Role Specification Tests', () => {
  let tempRoleModel: any;
  let userModel: any;
  let roleModel: any;
  let userRoleModel: any;
  let audit: any;
  let notifications: any;
  let service: TemporaryRoleService;

  const staffUserId = new Types.ObjectId().toString();
  const teamLeadUserId = new Types.ObjectId().toString();

  beforeEach(() => {
    tempRoleModel = {
      findOne: jest.fn().mockReturnValue(exec(null)),
      find: jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockReturnValue({
            sort: jest.fn().mockReturnValue(exec([])),
          }),
        }),
      }),
      create: jest.fn().mockImplementation(async (dto: any) => ({
        id: 'tr-req-123',
        _id: new Types.ObjectId(),
        ...dto,
      })),
      findById: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };

    userModel = {
      findById: jest.fn().mockReturnValue(exec({
        _id: staffUserId,
        fullName: 'Conversion Staff',
        email: 'staff@alsm.dev',
        isActive: true,
        isLocked: false,
        isPlatformAdmin: false,
      })),
    };

    roleModel = {
      findOne: jest.fn().mockReturnValue(exec({
        id: 'TEAM_LEAD',
        name: 'Team Lead',
      })),
    };

    userRoleModel = {
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue(exec([{ userId: teamLeadUserId }])),
        }),
      }),
    };

    audit = {
      append: jest.fn().mockResolvedValue(true),
    };

    notifications = {
      createForUsers: jest.fn().mockResolvedValue(1),
    };

    service = new TemporaryRoleService(
      tempRoleModel as any,
      userModel as any,
      roleModel as any,
      audit as any,
      userRoleModel as any,
      notifications as any,
    );
  });

  describe('1. Request Creation and Validation', () => {
    it('successfully submits a valid temporary role request', async () => {
      const result = await service.requestTemporaryRole(
        staffUserId,
        'TEAM_LEAD',
        8,
        REASON,
        'proj-456',
      );

      expect(result).toBeDefined();
      expect(result.roleId).toBe('TEAM_LEAD');
      expect(result.durationHours).toBe(8);
      expect(result.requestStatus).toBe('PENDING');
      expect(result.status).toBe('REVOKED'); // Inactive until approved
      expect(audit.append).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: staffUserId,
          action: 'TEMPORARY_ROLE_REQUESTED',
        }),
      );
    });

    it('rejects request with duration exceeding 24 hours', async () => {
      await expect(
        service.requestTemporaryRole(staffUserId, 'TEAM_LEAD', 25, REASON),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects request with duration below 1 hour', async () => {
      await expect(
        service.requestTemporaryRole(staffUserId, 'TEAM_LEAD', 0, REASON),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects request with justification shorter than 10 characters', async () => {
      await expect(
        service.requestTemporaryRole(staffUserId, 'TEAM_LEAD', 4, 'Too short'),
      ).rejects.toMatchObject({
        response: { code: 'JUSTIFICATION_TOO_SHORT' },
      });
    });

    it.each(['PLATFORM_ADMIN', 'SYSTEM_ADMIN', 'ADMIN'])(
      'strictly rejects requesting Platform Admin role %s',
      async (adminRole) => {
        await expect(
          service.requestTemporaryRole(staffUserId, adminRole, 4, REASON),
        ).rejects.toThrow(ForbiddenException);
      },
    );

    it('rejects request if user already holds an active temporary role', async () => {
      tempRoleModel.findOne.mockReturnValueOnce(
        exec({ id: 'active-temp-role-1', status: 'ACTIVE' }),
      );

      await expect(
        service.requestTemporaryRole(staffUserId, 'TEAM_LEAD', 4, REASON),
      ).rejects.toMatchObject({
        response: { code: 'ACTIVE_TEMPORARY_ROLE_EXISTS' },
      });
    });

    it('rejects request if user already has a pending request awaiting review', async () => {
      // First findOne (active check) returns null
      tempRoleModel.findOne
        .mockReturnValueOnce(exec(null))
        // Second findOne (pending check) returns existing pending request
        .mockReturnValueOnce(exec({ id: 'pending-req-1', requestStatus: 'PENDING' }));

      await expect(
        service.requestTemporaryRole(staffUserId, 'TEAM_LEAD', 4, REASON),
      ).rejects.toMatchObject({
        response: { code: 'PENDING_TEMPORARY_ROLE_REQUEST_EXISTS' },
      });
    });

    it('rejects request if requester account is locked', async () => {
      userModel.findById.mockReturnValue(
        exec({ _id: staffUserId, isLocked: true, isActive: true }),
      );

      await expect(
        service.requestTemporaryRole(staffUserId, 'TEAM_LEAD', 4, REASON),
      ).rejects.toThrow('A locked account cannot request a temporary role');
    });

    it('rejects request if requester account is deactivated', async () => {
      userModel.findById.mockReturnValue(
        exec({ _id: staffUserId, isLocked: false, isActive: false }),
      );

      await expect(
        service.requestTemporaryRole(staffUserId, 'TEAM_LEAD', 4, REASON),
      ).rejects.toThrow('A deactivated account cannot request a temporary role');
    });
  });

  describe('2. Request Approval & Rejection Workflow', () => {
    const createMockPendingRequest = (overrides = {}) => {
      const docId = new Types.ObjectId();
      return {
        id: docId.toString(),
        _id: docId,
        userId: new Types.ObjectId(staffUserId),
        roleId: 'TEAM_LEAD',
        durationHours: 6,
        reason: REASON,
        requestStatus: 'PENDING',
        status: 'REVOKED',
        save: jest.fn().mockResolvedValue(true),
        ...overrides,
      };
    };

    it('Team Lead approves request: integrates with UC-91 to grant temporary role', async () => {
      const pendingDoc = createMockPendingRequest();
      tempRoleModel.findById.mockReturnValue(exec(pendingDoc));

      const approvedResult = await service.reviewRequest(teamLeadUserId, pendingDoc.id, true);

      expect(approvedResult.status).toBe('ACTIVE');
      expect(approvedResult.requestStatus).toBe('APPROVED');
      expect(approvedResult.grantedBy.toString()).toBe(teamLeadUserId);
      expect(pendingDoc.save).toHaveBeenCalled();
      expect(audit.append).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: teamLeadUserId,
          action: 'TEMPORARY_ROLE_REQUEST_APPROVED',
        }),
      );
    });

    it('Team Lead rejects request with mandatory reason', async () => {
      const pendingDoc = createMockPendingRequest();
      tempRoleModel.findById.mockReturnValue(exec(pendingDoc));

      const rejectionReason = 'Insufficient justification for elevated access';
      const rejectedResult = await service.reviewRequest(
        teamLeadUserId,
        pendingDoc.id,
        false,
        rejectionReason,
      );

      expect(rejectedResult.requestStatus).toBe('REJECTED');
      expect(rejectedResult.status).toBe('REVOKED');
      expect(rejectedResult.revocationReason).toBe(rejectionReason);
      expect(pendingDoc.save).toHaveBeenCalled();
      expect(audit.append).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: teamLeadUserId,
          action: 'TEMPORARY_ROLE_REQUEST_REJECTED',
        }),
      );
    });

    it('fails rejection when reason is missing or empty', async () => {
      const pendingDoc = createMockPendingRequest();
      tempRoleModel.findById.mockReturnValue(exec(pendingDoc));

      await expect(
        service.reviewRequest(teamLeadUserId, pendingDoc.id, false, '   '),
      ).rejects.toMatchObject({
        response: { code: 'REJECTION_REASON_REQUIRED' },
      });
    });

    it('strictly forbids self-review (requester cannot approve own request)', async () => {
      const pendingDoc = createMockPendingRequest({
        userId: new Types.ObjectId(staffUserId),
      });
      tempRoleModel.findById.mockReturnValue(exec(pendingDoc));

      await expect(
        service.reviewRequest(staffUserId, pendingDoc.id, true),
      ).rejects.toThrow('You cannot review your own temporary role request');
    });

    it('cannot review a request that is already approved or rejected', async () => {
      const alreadyReviewedDoc = createMockPendingRequest({
        requestStatus: 'APPROVED',
      });
      tempRoleModel.findById.mockReturnValue(exec(alreadyReviewedDoc));

      await expect(
        service.reviewRequest(teamLeadUserId, alreadyReviewedDoc.id, true),
      ).rejects.toMatchObject({
        response: { code: 'REQUEST_ALREADY_REVIEWED' },
      });
    });
  });

  describe('3. Permission Guarding & Expiration', () => {
    it('verifies pending requests do not grant any effective permissions', async () => {
      const mockRbacRepo = {
        findUserRoles: jest.fn().mockResolvedValue(['CONVERSION_STAFF']),
        findUserById: jest.fn().mockResolvedValue({ isPlatformAdmin: false }),
        findPermissions: jest.fn(),
        findRolePermissionsByRoleIds: jest.fn().mockResolvedValue(['conversions.view']),
      };

      // tempRoleModel only finds active ones with expiresAt > now
      const mockActiveTempModel = {
        find: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([]), // No active temporary roles (pending is REVOKED)
        }),
      };

      const permService = new EffectivePermissionsService(
        mockRbacRepo as any,
        mockActiveTempModel as any,
      );

      const roles = await permService.getUserRoles(staffUserId);
      expect(roles).toEqual(['CONVERSION_STAFF']);
      expect(roles).not.toContain('TEAM_LEAD');
    });

    it('expires active temporary roles when cron runs', async () => {
      const result = await service.expireTemporaryRolesCron();
      expect(result.expiredCount).toBe(1);
      expect(tempRoleModel.updateMany).toHaveBeenCalledWith(
        { status: 'ACTIVE', expiresAt: { $lte: expect.any(Date) } },
        { $set: { status: 'EXPIRED' } },
      );
    });
  });
});
