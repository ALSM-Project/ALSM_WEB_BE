import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  ResourceTransferApprovalService,
  RESOURCE_TRANSFER_APPROVED,
  RESOURCE_TRANSFER_REJECTED,
} from '../src/modules/projects/application/resource-transfer-approval.service';
import { ResourceTransferRequestRecord } from '../src/modules/projects/domain/resource-transfer-request.types';

describe('ResourceTransferApprovalService (UC-88)', () => {
  const mockRequestRepo = {
    create: jest.fn(),
    findById: jest.fn(),
    findAll: jest.fn(),
    update: jest.fn(),
  };

  const mockProjectsRepo = {
    findById: jest.fn(),
    findAll: jest.fn(),
  };

  const mockStaffAllocationService = {
    assign: jest.fn(),
  };

  const mockRbac = {
    getAllUsers: jest.fn(),
  };

  const mockAudit = {
    append: jest.fn(),
  };

  let service: ResourceTransferApprovalService;

  const mockProject = {
    id: 'proj-1',
    name: 'Core Banking Migration',
    organizationId: 'org-1',
    conversionType: 'COBOL_TO_JAVA',
    status: 'ACTIVE',
    createdBy: 'lead-1',
    assignedTeamLeadId: 'lead-1',
    assignedStaffId: 'staff-old',
    assignedStaffName: 'Old Staff',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockTeamLead = {
    id: 'lead-1',
    email: 'teamlead@alsm.io',
    fullName: 'Lead Sarah',
    isPlatformAdmin: false,
    isLocked: false,
    roles: ['TEAM_LEAD'],
  };

  const mockNewStaff = {
    id: 'staff-new',
    email: 'newstaff@alsm.io',
    fullName: 'New Staff Alex',
    isPlatformAdmin: false,
    isLocked: false,
    roles: ['CONVERSION_STAFF'],
  };

  const mockPendingRequest: ResourceTransferRequestRecord = {
    id: 'req-1',
    organizationId: 'org-1',
    projectId: 'proj-1',
    projectName: 'Core Banking Migration',
    currentAssigneeId: 'staff-old',
    currentAssigneeName: 'Old Staff',
    targetAssigneeId: 'staff-new',
    targetAssigneeName: 'New Staff Alex',
    targetAssigneeEmail: 'newstaff@alsm.io',
    requestedById: 'lead-1',
    requestedByName: 'Lead Sarah',
    reason: 'Workload Balancing',
    note: 'Handle active screens',
    status: 'PENDING',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    jest.resetAllMocks();
    service = new ResourceTransferApprovalService(
      mockRequestRepo as never,
      mockProjectsRepo as never,
      mockStaffAllocationService as never,
      mockRbac as never,
      mockAudit as never,
    );

    mockRbac.getAllUsers.mockResolvedValue([mockTeamLead, mockNewStaff]);
    mockProjectsRepo.findById.mockResolvedValue(mockProject);
    mockProjectsRepo.findAll.mockResolvedValue([mockProject]);
    mockRequestRepo.findAll.mockResolvedValue([]);
    mockAudit.append.mockResolvedValue(undefined);
  });

  describe('createRequest', () => {
    it('creates a new transfer request in PENDING status', async () => {
      mockRequestRepo.create.mockResolvedValue(mockPendingRequest);

      const result = await service.createRequest('lead-1', {
        projectId: 'proj-1',
        targetStaffId: 'staff-new',
        reason: 'Workload Balancing',
        note: 'Handle active screens',
      });

      expect(mockRequestRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'proj-1',
          targetAssigneeId: 'staff-new',
          status: 'PENDING',
        }),
      );
      expect(result.status).toBe('PENDING');
    });

    it('rejects if project does not exist', async () => {
      mockProjectsRepo.findById.mockResolvedValue(null);
      mockProjectsRepo.findAll.mockResolvedValue([]);

      await expect(
        service.createRequest('lead-1', {
          projectId: 'proj-unknown',
          targetStaffId: 'staff-new',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects if a pending request already exists for the project', async () => {
      mockRequestRepo.findAll.mockResolvedValue([mockPendingRequest]);

      await expect(
        service.createRequest('lead-1', {
          projectId: 'proj-1',
          targetStaffId: 'staff-new',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects if target staff member is locked', async () => {
      mockRbac.getAllUsers.mockResolvedValue([
        mockTeamLead,
        { ...mockNewStaff, isLocked: true },
      ]);

      await expect(
        service.createRequest('lead-1', {
          projectId: 'proj-1',
          targetStaffId: 'staff-new',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects if target staff is already the current assignee', async () => {
      mockProjectsRepo.findById.mockResolvedValue({
        ...mockProject,
        assignedStaffId: 'staff-new',
      });

      await expect(
        service.createRequest('lead-1', {
          projectId: 'proj-1',
          targetStaffId: 'staff-new',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('approveRequest (UC-88 & UC-84 Integration)', () => {
    it('successfully approves request, invokes UC-84 transfer, and writes audit log', async () => {
      mockRequestRepo.findById.mockResolvedValue(mockPendingRequest);
      const updatedProject = {
        ...mockProject,
        assignedStaffId: 'staff-new',
        assignedStaffName: 'New Staff Alex',
      };
      mockStaffAllocationService.assign.mockResolvedValue(updatedProject);
      mockRequestRepo.update.mockResolvedValue({
        ...mockPendingRequest,
        status: 'APPROVED',
        reviewedById: 'lead-1',
        reviewedByName: 'Lead Sarah',
      });

      const result = await service.approveRequest('lead-1', 'req-1', {
        note: 'Approved for Q4 sprint',
      });

      expect(mockStaffAllocationService.assign).toHaveBeenCalledWith(
        'lead-1',
        'proj-1',
        'staff-new',
        'Handle active screens',
        'Workload Balancing',
      );
      expect(mockRequestRepo.update).toHaveBeenCalledWith(
        'req-1',
        expect.objectContaining({
          status: 'APPROVED',
          reviewedById: 'lead-1',
        }),
      );
      expect(mockAudit.append).toHaveBeenCalledWith(
        expect.objectContaining({
          action: RESOURCE_TRANSFER_APPROVED,
          resourceId: 'proj-1',
          metadata: expect.objectContaining({
            requestId: 'req-1',
            newAssigneeId: 'staff-new',
          }),
        }),
      );
      expect(result.success).toBe(true);
      expect(result.project.assignedStaffId).toBe('staff-new');
    });

    it('rejects approval if request is already processed (APPROVED or REJECTED)', async () => {
      mockRequestRepo.findById.mockResolvedValue({
        ...mockPendingRequest,
        status: 'APPROVED',
      });

      await expect(
        service.approveRequest('lead-1', 'req-1'),
      ).rejects.toThrow(BadRequestException);
      expect(mockStaffAllocationService.assign).not.toHaveBeenCalled();
    });

    it('rejects approval if actor is not an authorized Team Lead or Admin', async () => {
      mockRequestRepo.findById.mockResolvedValue(mockPendingRequest);
      mockRbac.getAllUsers.mockResolvedValue([
        {
          id: 'unauthorized-user',
          email: 'guest@alsm.io',
          roles: ['VIEWER'],
          isPlatformAdmin: false,
          isLocked: false,
        },
        mockNewStaff,
      ]);

      await expect(
        service.approveRequest('unauthorized-user', 'req-1'),
      ).rejects.toThrow(ForbiddenException);
      expect(mockStaffAllocationService.assign).not.toHaveBeenCalled();
    });

    it('fails safely without updating request when UC-84 assign throws', async () => {
      mockRequestRepo.findById.mockResolvedValue(mockPendingRequest);
      mockStaffAllocationService.assign.mockRejectedValue(
        new BadRequestException('Target staff overloaded'),
      );

      await expect(
        service.approveRequest('lead-1', 'req-1'),
      ).rejects.toThrow(BadRequestException);
      expect(mockRequestRepo.update).not.toHaveBeenCalled();
      expect(mockAudit.append).not.toHaveBeenCalled();
    });
  });

  describe('rejectRequest', () => {
    it('marks request as REJECTED and writes audit log', async () => {
      mockRequestRepo.findById.mockResolvedValue(mockPendingRequest);
      mockRequestRepo.update.mockResolvedValue({
        ...mockPendingRequest,
        status: 'REJECTED',
        rejectionReason: 'Assignee workload too high',
      });

      const result = await service.rejectRequest('lead-1', 'req-1', {
        reason: 'Assignee workload too high',
      });

      expect(mockRequestRepo.update).toHaveBeenCalledWith(
        'req-1',
        expect.objectContaining({
          status: 'REJECTED',
          rejectionReason: 'Assignee workload too high',
        }),
      );
      expect(mockAudit.append).toHaveBeenCalledWith(
        expect.objectContaining({
          action: RESOURCE_TRANSFER_REJECTED,
          resourceId: 'proj-1',
        }),
      );
      expect(result.success).toBe(true);
    });
  });

  describe('getRequestById', () => {
    it('returns authoritative live checks and validation flags', async () => {
      mockRequestRepo.findById.mockResolvedValue(mockPendingRequest);

      const result = await service.getRequestById('lead-1', 'req-1');

      expect(result.isValid).toBe(true);
      expect(result.validationErrors).toHaveLength(0);
      expect(result.liveProject?.id).toBe('proj-1');
    });

    it('flags validation errors when project has disappeared or staff is locked', async () => {
      mockRequestRepo.findById.mockResolvedValue(mockPendingRequest);
      mockProjectsRepo.findById.mockResolvedValue(null);
      mockProjectsRepo.findAll.mockResolvedValue([]);
      mockRbac.getAllUsers.mockResolvedValue([
        mockTeamLead,
        { ...mockNewStaff, isLocked: true },
      ]);

      const result = await service.getRequestById('lead-1', 'req-1');

      expect(result.isValid).toBe(false);
      expect(result.validationErrors).toEqual(
        expect.arrayContaining([
          expect.stringContaining('project no longer exists'),
          expect.stringContaining('staff member is locked'),
        ]),
      );
    });
  });
});
