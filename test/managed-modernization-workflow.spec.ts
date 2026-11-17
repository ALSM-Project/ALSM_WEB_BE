import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  ConversionType,
  ManagedProjectStage,
  MANAGED_PROJECT_STAGE_ORDER,
  ProjectRecord,
  ProjectRepository,
  ProjectStatus,
} from '../src/modules/projects/domain/project.types';
import { ProjectService } from '../src/modules/projects/application/project.service';

describe('ALSM Managed Modernization Workflow Specification', () => {
  let projectService: ProjectService;
  let mockProjectsRepo: jest.Mocked<ProjectRepository>;
  let mockOrgContext: any;
  let mockAuth: any;
  let mockAudit: any;
  let mockWorkforce: any;
  let mockRbac: any;

  const mockProject: ProjectRecord = {
    id: '672000000000000000000001',
    organizationId: '672000000000000000000010',
    name: 'Core Banking Modernization (Managed)',
    description: 'BMS to React and COBOL to Java managed migration',
    conversionType: ConversionType.BMS_DSPF_TO_FRONTEND,
    serviceType: 'MANAGED',
    contractNumber: 'ALSM-CTR-2026-9A52',
    contractId: 'ctr-managed-001',
    status: ProjectStatus.SUBMITTED,
    currentStage: ManagedProjectStage.REQUIREMENTS_GATHERING,
    stageIndex: 1,
    progressPct: 11,
    submittedAt: new Date(),
    submittedBy: '672000000000000000000020',
    businessRequirements: 'Strict 3270 keystroke parity required',
    createdBy: '672000000000000000000020',
    files: [
      {
        fileId: 'file-001',
        originalName: 'ACCT01.BMS',
        fileSize: 45000,
        category: 'SOURCE_CODE',
      },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    mockProjectsRepo = {
      create: jest.fn().mockImplementation((input) => Promise.resolve({ ...input, id: '672000000000000000000001', createdAt: new Date(), updatedAt: new Date() })),
      findById: jest.fn().mockResolvedValue(mockProject),
      findAll: jest.fn().mockResolvedValue([mockProject]),
      update: jest.fn().mockImplementation((id, orgId, patch) => Promise.resolve({ ...mockProject, ...patch })),
      assignTeamLead: jest.fn().mockImplementation((id, assignment) =>
        Promise.resolve({
          ...mockProject,
          assignedTeamLeadId: assignment.teamLeadId,
          assignedTeamLeadName: assignment.teamLeadName,
          teamLeadAssignedBy: assignment.assignedBy,
          teamLeadAssignedByName: assignment.assignedByName,
          teamLeadAssignmentNote: assignment.note,
          status: ProjectStatus.IN_PROGRESS,
          currentStage: ManagedProjectStage.LEGACY_ANALYSIS,
          stageIndex: 2,
          progressPct: 22,
        })
      ),
      updateStage: jest.fn().mockImplementation((id, stage, stageIndex, progressPct, status) =>
        Promise.resolve({
          ...mockProject,
          currentStage: stage,
          stageIndex,
          progressPct,
          status: status || mockProject.status,
        })
      ),
      recordAcceptance: jest.fn().mockImplementation((id, acceptance) =>
        Promise.resolve({
          ...mockProject,
          acceptance,
          status: ProjectStatus.COMPLETED,
          currentStage: ManagedProjectStage.DELIVERY,
          stageIndex: 9,
          progressPct: 100,
        })
      ),
      findByAssignedStaff: jest.fn().mockResolvedValue([]),
      assignStaff: jest.fn().mockResolvedValue(mockProject),
      removeStaff: jest.fn().mockResolvedValue(mockProject),
      softDelete: jest.fn().mockResolvedValue(true),
    };

    mockOrgContext = {
      resolve: jest.fn().mockResolvedValue({ id: '672000000000000000000010', name: 'Partner Org', members: [] }),
    };

    mockAuth = {
      require: jest.fn(),
    };

    mockAudit = {
      append: jest.fn().mockResolvedValue(undefined),
    };

    mockWorkforce = {
      validateInternalEmployee: jest.fn().mockImplementation((userId) => {
        if (userId === 'external-customer-01') {
          throw new BadRequestException('Selected user is not an active ALSM internal employee');
        }
        return Promise.resolve({ id: 'membership-01', userId });
      }),
      getInternalEmployees: jest.fn().mockResolvedValue([
        { userId: 'internal-lead-01', fullName: 'Huu Nghia', email: 'teamlead@alsm.dev', role: 'Team Lead', status: 'ACTIVE' },
      ]),
    };

    mockRbac = {
      getAllUsers: jest.fn().mockResolvedValue([
        { id: 'admin-01', fullName: 'ALSM Platform Admin', email: 'admin@alsm.dev' },
        { id: 'internal-lead-01', fullName: 'Huu Nghia', email: 'teamlead@alsm.dev' },
        { id: 'customer-01', fullName: 'Customer Representative', email: 'cust@partner.com' },
      ]),
    };

    projectService = new ProjectService(
      mockProjectsRepo,
      mockOrgContext,
      mockAuth,
      mockAudit,
      mockWorkforce,
      mockRbac,
    );
  });

  describe('Step 1 — Customer Submission (Web3)', () => {
    it('creates a Managed Project with status SUBMITTED, stage REQUIREMENTS_GATHERING (11%), and contract reference', async () => {
      const created = await projectService.create('customer-01', '672000000000000000000010', {
        name: 'Banking Modernization',
        conversionType: ConversionType.BMS_DSPF_TO_FRONTEND,
        serviceType: 'MANAGED',
        contractNumber: 'ALSM-CTR-2026-9A52',
        contractId: 'ctr-managed-001',
        businessRequirements: 'Full 3270 screen parity',
      });

      expect(created.status).toBe(ProjectStatus.SUBMITTED);
      expect(created.currentStage).toBe(ManagedProjectStage.REQUIREMENTS_GATHERING);
      expect(created.stageIndex).toBe(1);
      expect(created.progressPct).toBe(11);
      expect(created.contractNumber).toBe('ALSM-CTR-2026-9A52');
      expect(mockAudit.append).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'MANAGED_PROJECT_SUBMITTED' })
      );
    });
  });

  describe('Step 2 — Admin Intake & Review (Web2)', () => {
    it('transitions project status to READY_FOR_ASSIGNMENT when Admin approves', async () => {
      const updated = await projectService.adminReview('admin-01', mockProject.id, 'APPROVE', 'Input files valid');
      expect(updated.status).toBe(ProjectStatus.READY_FOR_ASSIGNMENT);
      expect(mockAudit.append).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'PROJECT_REVIEW_APPROVE' })
      );
    });

    it('transitions project status to NEEDS_INFO when Admin requests clarification', async () => {
      const updated = await projectService.adminReview('admin-01', mockProject.id, 'REQUEST_INFO', 'Missing copybook files');
      expect(updated.status).toBe(ProjectStatus.NEEDS_INFO);
      expect(mockAudit.append).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'PROJECT_REVIEW_REQUEST_INFO' })
      );
    });

    it('transitions project status to REJECTED when Admin rejects request', async () => {
      const updated = await projectService.adminReview('admin-01', mockProject.id, 'REJECT', 'Out of contract scope');
      expect(updated.status).toBe(ProjectStatus.REJECTED);
      expect(mockAudit.append).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'PROJECT_REVIEW_REJECT' })
      );
    });
  });

  describe('Step 3 — Admin Assigns Team Lead (Web2)', () => {
    it('strictly prevents assigning a Web3 Customer Organization user as Team Lead', async () => {
      await expect(
        projectService.assignTeamLead('admin-01', mockProject.id, 'external-customer-01', 'Test note')
      ).rejects.toThrow(BadRequestException);
    });

    it('successfully assigns an ALSM internal Web2 Team Lead and records assignment metadata', async () => {
      const assigned = await projectService.assignTeamLead(
        'admin-01',
        mockProject.id,
        'internal-lead-01',
        'Lead architect briefing: prioritize ACCT01 screen'
      );

      expect(assigned.assignedTeamLeadId).toBe('internal-lead-01');
      expect(assigned.assignedTeamLeadName).toBe('Huu Nghia');
      expect(assigned.teamLeadAssignedBy).toBe('admin-01');
      expect(assigned.teamLeadAssignmentNote).toBe('Lead architect briefing: prioritize ACCT01 screen');
      expect(assigned.status).toBe(ProjectStatus.IN_PROGRESS);
      expect(assigned.currentStage).toBe(ManagedProjectStage.LEGACY_ANALYSIS);
      expect(assigned.stageIndex).toBe(2);
      expect(assigned.progressPct).toBe(22);
      expect(mockAudit.append).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'PROJECT_ASSIGNED_TO_TEAM_LEAD' })
      );
    });
  });

  describe('Step 5 — Project Execution Across Canonical 9 Stages', () => {
    it('advances stages and calculates dynamic progress percentage based on 9 stages', async () => {
      // Advance to CONVERSION (stage 3)
      const stage3 = await projectService.updateStage('internal-lead-01', mockProject.id, ManagedProjectStage.CONVERSION);
      expect(stage3.currentStage).toBe(ManagedProjectStage.CONVERSION);
      expect(stage3.stageIndex).toBe(3);
      expect(stage3.progressPct).toBe(33); // Math.round(3/9 * 100)

      // Advance to CUSTOMER_REVIEW (stage 7) -> sets status AWAITING_CUSTOMER_REVIEW
      const stage7 = await projectService.updateStage('internal-lead-01', mockProject.id, ManagedProjectStage.CUSTOMER_REVIEW);
      expect(stage7.currentStage).toBe(ManagedProjectStage.CUSTOMER_REVIEW);
      expect(stage7.stageIndex).toBe(7);
      expect(stage7.progressPct).toBe(78); // Math.round(7/9 * 100)
      expect(stage7.status).toBe(ProjectStatus.AWAITING_CUSTOMER_REVIEW);

      // Advance to ACCEPTANCE (stage 8) -> sets status AWAITING_ACCEPTANCE
      const stage8 = await projectService.updateStage('internal-lead-01', mockProject.id, ManagedProjectStage.ACCEPTANCE);
      expect(stage8.currentStage).toBe(ManagedProjectStage.ACCEPTANCE);
      expect(stage8.stageIndex).toBe(8);
      expect(stage8.progressPct).toBe(89); // Math.round(8/9 * 100)
      expect(stage8.status).toBe(ProjectStatus.AWAITING_ACCEPTANCE);
    });
  });

  describe('Step 6 & 7 — Customer Progress Tracking & Formal Acceptance', () => {
    it('records customer acceptance, updates status to COMPLETED, and sets stage to DELIVERY (100%)', async () => {
      const accepted = await projectService.acceptProject(
        'customer-01',
        '672000000000000000000010',
        mockProject.id,
        'Validated ACCT01 BMS modern React screen. AST tests 100% passed. Accepted.'
      );

      expect(accepted.status).toBe(ProjectStatus.COMPLETED);
      expect(accepted.currentStage).toBe(ManagedProjectStage.DELIVERY);
      expect(accepted.stageIndex).toBe(9);
      expect(accepted.progressPct).toBe(100);
      expect(accepted.acceptance?.accepted).toBe(true);
      expect(accepted.acceptance?.acceptedBy).toBe('customer-01');
      expect(accepted.acceptance?.acceptedByName).toBe('Customer Representative');
      expect(accepted.acceptance?.notes).toBe(
        'Validated ACCT01 BMS modern React screen. AST tests 100% passed. Accepted.'
      );
      expect(mockAudit.append).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'PROJECT_ACCEPTED_BY_CUSTOMER' })
      );
    });
  });
});
