import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { UserOffboardingService } from '../src/modules/users/application/user-offboarding.service';

describe('UserOffboardingService (UC-83)', () => {
  let service: UserOffboardingService;

  const actorAdminId = new Types.ObjectId().toString();
  const actorTeamLeadId = new Types.ObjectId().toString();
  const targetStaffId = new Types.ObjectId().toString();
  const successorStaffId = new Types.ObjectId().toString();
  const projectId = new Types.ObjectId().toString();

  const mockTargetUser = {
    _id: new Types.ObjectId(targetStaffId),
    id: targetStaffId,
    email: 'departing.staff@alsm.io',
    fullName: 'Departing Staff',
    isActive: true,
    isLocked: false,
    isPlatformAdmin: false,
    mfa: { enabled: true, secret: 'SECRET', backupCodeHashes: ['hash1'] },
    save: jest.fn().mockResolvedValue(true),
  };

  const mockSuccessor = {
    _id: new Types.ObjectId(successorStaffId),
    id: successorStaffId,
    email: 'successor.staff@alsm.io',
    fullName: 'Successor Staff',
    isActive: true,
    isLocked: false,
    isPlatformAdmin: false,
    roles: ['CONVERSION_STAFF'],
    save: jest.fn().mockResolvedValue(true),
  };

  const mockProject = {
    _id: new Types.ObjectId(projectId),
    id: projectId,
    name: 'Oracle Modernization Pilot',
    status: 'ACTIVE',
    organizationId: new Types.ObjectId(),
    assignedStaffId: new Types.ObjectId(targetStaffId),
    assignedStaffName: 'Departing Staff',
    assignedTeamLeadId: new Types.ObjectId(actorTeamLeadId),
    save: jest.fn().mockResolvedValue(true),
  };

  const mockSession = {
    _id: new Types.ObjectId(),
    id: 'sess-01',
    userId: new Types.ObjectId(targetStaffId),
    deviceType: 'Desktop',
    browser: 'Chrome 124',
    ipAddress: '192.168.1.100',
    lastActiveAt: new Date(),
    createdAt: new Date(),
  };

  const mockJob = {
    _id: new Types.ObjectId(),
    id: 'job-01',
    projectId: new Types.ObjectId(projectId),
    status: 'QUEUED',
    priority: 'HIGH',
    conversionType: 'COBOL_TO_JAVA',
    createdBy: new Types.ObjectId(targetStaffId),
  };

  // Mock Mongoose Models
  const mockUserModel = {
    findById: jest.fn(),
    find: jest.fn(),
  };

  const mockProjectModel = {
    find: jest.fn(),
  };

  const mockJobModel = {
    find: jest.fn(),
    updateMany: jest.fn(),
  };

  const mockSessionModel = {
    find: jest.fn(),
    updateMany: jest.fn(),
  };

  const mockRbacService = {
    getUserRoles: jest.fn(),
    getAllUsers: jest.fn(),
    updateUserRoles: jest.fn(),
  };

  const mockAudit = {
    append: jest.fn(),
  };

  beforeEach(() => {
    jest.resetAllMocks();

    service = new UserOffboardingService(
      mockUserModel as never,
      mockProjectModel as never,
      mockJobModel as never,
      mockSessionModel as never,
      mockRbacService as never,
      mockAudit as never,
    );

    mockUserModel.findById.mockImplementation((id: Types.ObjectId) => ({
      exec: jest.fn().mockResolvedValue(
        id.toString() === targetStaffId
          ? { ...mockTargetUser, save: jest.fn().mockResolvedValue(true) }
          : id.toString() === successorStaffId
          ? { ...mockSuccessor, save: jest.fn().mockResolvedValue(true) }
          : null,
      ),
    }));

    mockUserModel.find.mockReturnValue({
      select: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue([mockSuccessor]),
      }),
    });

    mockProjectModel.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue([{ ...mockProject, save: jest.fn().mockResolvedValue(true) }]),
      }),
      select: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue([{ assignedStaffId: mockProject.assignedStaffId }]),
      }),
      exec: jest.fn().mockResolvedValue([{ ...mockProject, save: jest.fn().mockResolvedValue(true) }]),
    });

    mockJobModel.find.mockReturnValue({
      exec: jest.fn().mockResolvedValue([mockJob]),
    });

    mockJobModel.updateMany.mockResolvedValue({ modifiedCount: 1 });

    mockSessionModel.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue([mockSession]),
      }),
    });

    mockSessionModel.updateMany.mockResolvedValue({ modifiedCount: 1 });

    mockRbacService.getUserRoles.mockResolvedValue(['CONVERSION_STAFF']);
    mockRbacService.getAllUsers.mockResolvedValue([
      { id: successorStaffId, roles: ['CONVERSION_STAFF'] },
    ]);
    mockRbacService.updateUserRoles.mockResolvedValue([]);
    mockAudit.append.mockResolvedValue(undefined);
  });

  describe('getOffboardingSummary', () => {
    it('returns authoritative staff dossier, security sessions, assigned projects, and candidate successors', async () => {
      const summary = await service.getOffboardingSummary(actorAdminId, targetStaffId, true);

      expect(summary).toBeDefined();
      expect(summary.user.id).toBe(targetStaffId);
      expect(summary.user.email).toBe('departing.staff@alsm.io');
      expect(summary.activeSessionsCount).toBe(1);
      expect(summary.assignedProjects.length).toBe(1);
      expect(summary.assignedProjects[0].id).toBe(projectId);
      expect(summary.pendingJobsCount).toBe(1);
      expect(summary.eligibleStaff.length).toBe(1);
      expect(summary.eligibleStaff[0].id).toBe(successorStaffId);
    });

    it('rejects if target user does not exist', async () => {
      mockUserModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      await expect(
        service.getOffboardingSummary(actorAdminId, new Types.ObjectId().toString(), true),
      ).rejects.toThrow(NotFoundException);
    });

    it('denies Team Lead when attempting to review a Platform Admin account', async () => {
      mockUserModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          ...mockTargetUser,
          isPlatformAdmin: true,
        }),
      });

      await expect(
        service.getOffboardingSummary(actorTeamLeadId, targetStaffId, false),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('executeOffboarding', () => {
    it('rejects self-offboarding attempts', async () => {
      await expect(
        service.executeOffboarding(targetStaffId, targetStaffId, true),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects offboarding if target user is already inactive / offboarded', async () => {
      mockUserModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          ...mockTargetUser,
          isActive: false,
        }),
      });

      await expect(
        service.executeOffboarding(actorAdminId, targetStaffId, true, {
          transferToUserId: successorStaffId,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('denies Team Lead attempting to offboard a Platform Administrator', async () => {
      mockUserModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          ...mockTargetUser,
          isPlatformAdmin: true,
        }),
      });

      await expect(
        service.executeOffboarding(actorTeamLeadId, targetStaffId, false, {
          transferToUserId: successorStaffId,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('requires reassignment when departing user owns active projects', async () => {
      await expect(
        service.executeOffboarding(actorAdminId, targetStaffId, true, {}),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects if designated successor is the departing staff member', async () => {
      await expect(
        service.executeOffboarding(actorAdminId, targetStaffId, true, {
          transferToUserId: targetStaffId,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects if designated successor is inactive or locked', async () => {
      mockUserModel.findById.mockImplementation((id: Types.ObjectId) => ({
        exec: jest.fn().mockResolvedValue(
          id.toString() === targetStaffId
            ? { ...mockTargetUser }
            : { ...mockSuccessor, isLocked: true },
        ),
      }));

      await expect(
        service.executeOffboarding(actorAdminId, targetStaffId, true, {
          transferToUserId: successorStaffId,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('successfully executes offboarding, reassigns projects, invalidates sessions, revokes roles, and deactivates account', async () => {
      const result = await service.executeOffboarding(actorAdminId, targetStaffId, true, {
        transferToUserId: successorStaffId,
        reason: 'Contract completion',
        confirmDeactivation: true,
      });

      expect(result.success).toBe(true);
      expect(result.operations.projectsTransferred).toBe(1);
      expect(result.operations.sessionsRevoked).toBe(1);
      expect(result.operations.rolesRemoved).toBe(1);
      expect(result.operations.accountDeactivated).toBe(true);
      expect(result.user.isActive).toBe(false);
      expect(result.user.isLocked).toBe(true);

      // Verify sessions revoked
      expect(mockSessionModel.updateMany).toHaveBeenCalledWith(
        { userId: mockTargetUser._id, revokedAt: { $exists: false } },
        expect.any(Object),
      );

      // Verify roles cleared
      expect(mockRbacService.updateUserRoles).toHaveBeenCalledWith(targetStaffId, [], actorAdminId);

      // Verify audit logs appended
      expect(mockAudit.append).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'PROJECT_STAFF_ALLOCATED',
          resourceType: 'PROJECT',
        }),
      );
      expect(mockAudit.append).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'USER_ALL_SESSIONS_REVOKED',
          resourceType: 'USER_SESSION',
        }),
      );
      expect(mockAudit.append).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'USER_ROLES_REMOVED',
          resourceType: 'USER',
        }),
      );
      expect(mockAudit.append).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'USER_OFFBOARDED',
          resourceType: 'USER',
        }),
      );
    });

    it('supports granular per-project transfers to designated staff', async () => {
      const result = await service.executeOffboarding(actorAdminId, targetStaffId, true, {
        projectTransfers: [
          {
            projectId,
            targetStaffId: successorStaffId,
            reason: 'Rebalance team allocations',
          },
        ],
        confirmDeactivation: true,
      });

      expect(result.success).toBe(true);
      expect(result.operations.projectsTransferred).toBe(1);
      expect(result.transferredProjects[0].newOwnerId).toBe(successorStaffId);
    });
  });
});
