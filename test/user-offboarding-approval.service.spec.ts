import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Types, Model } from 'mongoose';
import { UserOffboardingApprovalService } from '../src/modules/users/application/user-offboarding-approval.service';
import {
  IOffboardingRequestRepository,
  OffboardingRequestRecord,
} from '../src/modules/users/domain/offboarding-request.types';
import { UserOffboardingService } from '../src/modules/users/application/user-offboarding.service';
import { RbacService } from '../src/modules/rbac/application/rbac.service';
import { AuditRepository } from '../src/modules/audit/domain/audit.repository';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { UserDocument } from '../src/modules/users/infrastructure/user.schema';
import { Team } from '../src/modules/teams/infrastructure/team.schema';

describe('UserOffboardingApprovalService (UC-89)', () => {
  let service: UserOffboardingApprovalService;

  const actorTeamLeadId = new Types.ObjectId().toString();
  const otherLeadId = new Types.ObjectId().toString();
  const targetStaffId = new Types.ObjectId().toString();
  const successorStaffId = new Types.ObjectId().toString();
  const teamId = new Types.ObjectId().toString();
  const organizationId = new Types.ObjectId().toString();

  const mockActorLead = {
    _id: new Types.ObjectId(actorTeamLeadId),
    id: actorTeamLeadId,
    email: 'teamlead@alsm.io',
    fullName: 'Team Lead Alice',
    isPlatformAdmin: false,
    isActive: true,
  };

  const mockOtherLead = {
    _id: new Types.ObjectId(otherLeadId),
    id: otherLeadId,
    email: 'otherlead@alsm.io',
    fullName: 'Team Lead Charlie',
    isPlatformAdmin: false,
    isActive: true,
  };

  const mockTargetUser = {
    _id: new Types.ObjectId(targetStaffId),
    id: targetStaffId,
    email: 'departing.dev@alsm.io',
    fullName: 'Departing Dev',
    isPlatformAdmin: false,
    isActive: true,
  };

  const mockSuccessor = {
    _id: new Types.ObjectId(successorStaffId),
    id: successorStaffId,
    email: 'successor@alsm.io',
    fullName: 'Successor Bob',
    isPlatformAdmin: false,
    isActive: true,
  };

  const mockTeam = {
    _id: new Types.ObjectId(teamId),
    id: teamId,
    name: 'Modernization Core Team',
    organizationId: new Types.ObjectId(organizationId),
    managerIds: [actorTeamLeadId],
    memberIds: [targetStaffId, successorStaffId],
  };

  const mockOffboardingRequest: OffboardingRequestRecord = {
    id: new Types.ObjectId().toString(),
    organizationId,
    teamId,
    teamName: 'Modernization Core Team',
    targetUserId: targetStaffId,
    targetUserName: 'Departing Dev',
    targetUserEmail: 'departing.dev@alsm.io',
    targetUserRoles: ['CONVERSION_STAFF'],
    requestedById: actorTeamLeadId,
    requestedByName: 'Team Lead Alice',
    requestedByEmail: 'teamlead@alsm.io',
    transferToUserId: successorStaffId,
    transferToUserName: 'Successor Bob',
    reason: 'Contract end',
    status: 'PENDING',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  let mockRequestRepo: jest.Mocked<IOffboardingRequestRepository>;
  let mockOffboardingService: jest.Mocked<Partial<UserOffboardingService>>;
  let mockRbacService: jest.Mocked<Partial<RbacService>>;
  let mockUserModel: unknown;
  let mockTeamModel: unknown;
  let mockAudit: jest.Mocked<AuditRepository>;
  let mockNotifications: jest.Mocked<Partial<NotificationsService>>;
  let mockWorkforceService: any;

  beforeEach(() => {
    mockRequestRepo = {
      create: jest.fn().mockImplementation((input) => ({
        id: new Types.ObjectId().toString(),
        createdAt: new Date(),
        updatedAt: new Date(),
        ...input,
      })),
      findById: jest.fn().mockResolvedValue({ ...mockOffboardingRequest }),
      findPendingByTargetUser: jest.fn().mockResolvedValue(null),
      findAll: jest.fn().mockResolvedValue([{ ...mockOffboardingRequest }]),
      update: jest.fn().mockImplementation((id, patch) => ({
        ...mockOffboardingRequest,
        ...patch,
      })),
    };

    mockOffboardingService = {
      getOffboardingSummary: jest.fn().mockResolvedValue({
        activeSessionsCount: 2,
        apiKeysCount: 1,
        assignedProjects: [
          {
            id: 'proj-1',
            name: 'Pilot Project',
            status: 'ACTIVE',
            assignedStaffId: targetStaffId,
            assignedStaffName: 'Departing Dev',
          },
        ],
        pendingJobsCount: 0,
        eligibleSuccessors: [
          {
            id: successorStaffId,
            fullName: 'Successor Bob',
            email: 'successor@alsm.io',
            roles: ['CONVERSION_STAFF'],
            activeProjectCount: 1,
          },
        ],
      }),
      executeOffboarding: jest.fn().mockResolvedValue({
        success: true,
        summary: {
          sessionsRevoked: 2,
          apiKeysRevoked: 1,
          projectsReassigned: 1,
          rolesRemoved: 1,
          accountDeactivated: true,
        },
      }),
    };

    mockRbacService = {
      getAllUsers: jest.fn().mockResolvedValue([
        { id: targetStaffId, roles: ['CONVERSION_STAFF'] },
        { id: successorStaffId, roles: ['CONVERSION_STAFF'] },
      ]),
    };

    mockUserModel = {
      findById: jest.fn().mockImplementation((oid: Types.ObjectId) => ({
        lean: () => ({
          exec: jest.fn().mockImplementation(() => {
            const sid = oid.toString();
            if (sid === actorTeamLeadId) return mockActorLead;
            if (sid === otherLeadId) return mockOtherLead;
            if (sid === targetStaffId) return mockTargetUser;
            if (sid === successorStaffId) return mockSuccessor;
            return null;
          }),
        }),
      })),
    };

    mockTeamModel = {
      find: jest.fn().mockImplementation((query: { memberIds?: string; managerIds?: string }) => ({
        lean: () => ({
          exec: jest.fn().mockImplementation(() => {
            if (query.memberIds === targetStaffId) return [mockTeam];
            if (query.managerIds === actorTeamLeadId) return [mockTeam];
            if (query.managerIds === otherLeadId) return [];
            return [mockTeam];
          }),
        }),
      })),
    };

    mockAudit = {
      append: jest.fn().mockResolvedValue(undefined),
    };

    mockWorkforceService = {
      validateInternalEmployee: jest.fn().mockResolvedValue({ id: 'mem-1' }),
      searchEmployees: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 10, totalPages: 1 }),
      getInternalOrganization: jest.fn().mockResolvedValue({ id: 'org-1' }),
    };

    mockNotifications = {
      createForUsers: jest.fn().mockResolvedValue(1),
    };

    service = new UserOffboardingApprovalService(
      mockRequestRepo,
      mockOffboardingService as unknown as UserOffboardingService,
      mockRbacService as unknown as RbacService,
      mockUserModel as unknown as Model<UserDocument>,
      mockTeamModel as unknown as Model<Team>,
      mockAudit,
      mockNotifications as unknown as NotificationsService,
      mockWorkforceService as never,
    );
  });

  describe('createRequest', () => {
    it('disallows requesting offboarding for oneself', async () => {
      await expect(
        service.createRequest(targetStaffId, {
          targetUserId: targetStaffId,
          reason: 'Leaving company',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects if target staff is not found', async () => {
      const nonExistent = new Types.ObjectId().toString();
      await expect(
        service.createRequest(actorTeamLeadId, {
          targetUserId: nonExistent,
          reason: 'Leaving company',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects if an offboarding request is already pending', async () => {
      mockRequestRepo.findPendingByTargetUser.mockResolvedValueOnce({
        ...mockOffboardingRequest,
        id: 'existing-req',
        status: 'PENDING',
      });

      await expect(
        service.createRequest(actorTeamLeadId, {
          targetUserId: targetStaffId,
          reason: 'Contract end',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects if Team Lead does not manage the target user', async () => {
      await expect(
        service.createRequest(otherLeadId, {
          targetUserId: targetStaffId,
          reason: 'Contract end',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('successfully creates an offboarding request and appends audit log', async () => {
      const res = await service.createRequest(actorTeamLeadId, {
        targetUserId: targetStaffId,
        transferToUserId: successorStaffId,
        reason: 'Project handover and contract end',
      });

      expect(res).toBeDefined();
      expect(res.status).toBe('PENDING');
      expect(mockRequestRepo.create).toHaveBeenCalled();
      expect(mockAudit.append).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'OFFBOARDING_REQUEST_CREATED',
        }),
      );
    });
  });

  describe('listRequests', () => {
    it('returns all requests for Platform Admin', async () => {
      const res = await service.listRequests(actorTeamLeadId, true);
      expect(res).toHaveLength(1);
      expect(mockRequestRepo.findAll).toHaveBeenCalledWith({});
    });

    it('scopes requests to managed team members for Team Lead', async () => {
      const res = await service.listRequests(actorTeamLeadId, false);
      expect(res).toHaveLength(1);
    });
  });

  describe('getRequestDetails', () => {
    it('throws NotFoundException if request does not exist', async () => {
      mockRequestRepo.findById.mockResolvedValueOnce(null);
      await expect(
        service.getRequestDetails(actorTeamLeadId, 'non-existent-id'),
      ).rejects.toThrow(NotFoundException);
    });

    it('retrieves request details with live UC-83 resource impact review', async () => {
      const details = await service.getRequestDetails(
        actorTeamLeadId,
        mockOffboardingRequest.id,
      );

      expect(details.request.id).toBe(mockOffboardingRequest.id);
      expect(details.liveSummary).toBeDefined();
      expect(
        (details.liveSummary as { assignedProjects?: unknown[] })
          .assignedProjects,
      ).toHaveLength(1);
      expect(mockOffboardingService.getOffboardingSummary).toHaveBeenCalledWith(
        actorTeamLeadId,
        targetStaffId,
        false,
      );
    });
  });

  describe('approveRequest', () => {
    it('rejects approval if request is not PENDING', async () => {
      mockRequestRepo.findById.mockResolvedValueOnce({
        ...mockOffboardingRequest,
        status: 'APPROVED',
      });

      await expect(
        service.approveRequest(actorTeamLeadId, mockOffboardingRequest.id, {}),
      ).rejects.toThrow(BadRequestException);
    });

    it('executes UC-83 offboarding and marks request as APPROVED', async () => {
      const result = await service.approveRequest(
        actorTeamLeadId,
        mockOffboardingRequest.id,
        {
          note: 'Approved during sprint transition',
        },
      );

      expect(result.executionResult.success).toBe(true);
      expect(mockOffboardingService.executeOffboarding).toHaveBeenCalled();
      expect(mockRequestRepo.update).toHaveBeenCalledWith(
        mockOffboardingRequest.id,
        expect.objectContaining({
          status: 'APPROVED',
          reviewedById: actorTeamLeadId,
        }),
      );
      expect(mockAudit.append).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'OFFBOARDING_REQUEST_APPROVED',
        }),
      );
      expect(mockNotifications.createForUsers).toHaveBeenCalled();
    });
  });

  describe('rejectRequest', () => {
    it('requires a non-empty rejection reason', async () => {
      await expect(
        service.rejectRequest(actorTeamLeadId, mockOffboardingRequest.id, {
          rejectionReason: '',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('marks request as REJECTED and does NOT execute offboarding', async () => {
      const result = await service.rejectRequest(
        actorTeamLeadId,
        mockOffboardingRequest.id,
        {
          rejectionReason: 'Active project deliverables still required this month',
        },
      );

      expect(result.status).toBe('REJECTED');
      expect(mockOffboardingService.executeOffboarding).not.toHaveBeenCalled();
      expect(mockRequestRepo.update).toHaveBeenCalledWith(
        mockOffboardingRequest.id,
        expect.objectContaining({
          status: 'REJECTED',
          rejectionReason:
            'Active project deliverables still required this month',
        }),
      );
      expect(mockAudit.append).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'OFFBOARDING_REQUEST_REJECTED',
        }),
      );
    });
  });
});
