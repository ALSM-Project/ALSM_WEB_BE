import { Types } from 'mongoose';
import { SalesCrmService } from '../src/modules/crm/application/sales-crm.service';
import { PlatformAdminService } from '../src/modules/admin/application/platform-admin.service';
import { TemporaryRoleService } from '../src/modules/rbac/application/temporary-role.service';
import { EffectivePermissionsService } from '../src/modules/rbac/application/effective-permissions.service';
import { ProjectService } from '../src/modules/projects/application/project.service';
import { ConversionType, ProjectStatus } from '../src/modules/projects/domain/project.types';

describe('Internal Staff Portal & Platform Administration Workflows', () => {
  const auditRepo = {
    append: jest.fn().mockResolvedValue(undefined),
  };

  describe('3.10 Internal Technical & Support', () => {
    it('3.10.3: creates a pre-configured demo project marked with isDemo: true and audit logged', async () => {
      const projectRepo = {
        create: jest.fn().mockImplementation((dto) => Promise.resolve({ id: 'demo-p-1', ...dto })),
        findById: jest.fn(),
        findAll: jest.fn(),
        update: jest.fn(),
        assignTeamLead: jest.fn(),
        softDelete: jest.fn(),
      };
      const orgContext = {
        resolve: jest.fn().mockResolvedValue({ id: 'org-internal-1' }),
      };
      const orgAuth = {
        require: jest.fn(),
      };

      const projectService = new ProjectService(
        projectRepo as never,
        orgContext as never,
        orgAuth as never,
        auditRepo as never,
      );

      const demo = await projectService.createDemo('user-staff-1', 'org-internal-1', {
        name: 'Demo Core Banking Modernization',
      });

      expect(demo.isDemo).toBe(true);
      expect(demo.conversionType).toBe(ConversionType.BMS_DSPF_TO_FRONTEND);
      expect(demo.status).toBe(ProjectStatus.ACTIVE);
      expect(auditRepo.append).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DEMO_PROJECT_CREATED',
          resourceType: 'PROJECT',
        }),
      );
    });

    it('3.10.4: support impersonates customer organisation with read-only context and audit trail', async () => {
      const mockOrg = {
        id: 'org-cust-1',
        _id: new Types.ObjectId(),
        name: 'Acme Bank Enterprise',
        type: 'ENTERPRISE',
      };
      const orgModel = {
        findById: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(mockOrg) }),
        findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(mockOrg) }),
      };

      const adminService = new PlatformAdminService(
        orgModel as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        auditRepo as never,
      );

      const result = await adminService.impersonateOrganization('support-user-1', 'org-cust-1');

      expect(result.readOnly).toBe(true);
      expect(result.organizationName).toBe('Acme Bank Enterprise');
      expect(auditRepo.append).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'ORGANISATION_IMPERSONATED',
          metadata: expect.objectContaining({ readOnly: 'true' }),
        }),
      );
    });
  });

  describe('3.11 & 3.12 CRM, Sales Management & Approvals', () => {
    let salesCrmService: SalesCrmService;
    let mockLead: Record<string, unknown> & {
      interactions: Record<string, unknown>[];
      demos: Record<string, unknown>[];
      quotes: Record<string, unknown>[];
      contracts: Record<string, unknown>[];
      save: jest.Mock;
      [key: string]: unknown;
    };
    let leadModel: {
      find: jest.Mock;
      findById: jest.Mock;
      findOne: jest.Mock;
      create: jest.Mock;
    };
    let orgModel: {
      findOne: jest.Mock;
      create: jest.Mock;
      findById?: jest.Mock;
    };
    let userModel: {
      findOne?: jest.Mock;
      create?: jest.Mock;
      findById?: jest.Mock;
      find?: jest.Mock;
    };

    beforeEach(() => {
      mockLead = {
        id: 'lead-1',
        _id: new Types.ObjectId(),
        organizationId: new Types.ObjectId(),
        contactName: 'Jane Smith',
        company: 'Fintech Solutions',
        contactEmail: 'jane@fintech.com',
        stage: 'NEW',
        score: 65,
        interactions: [],
        demos: [],
        quotes: [],
        contracts: [],
        save: jest.fn().mockResolvedValue(true),
      };

      leadModel = {
        find: jest.fn().mockReturnValue({
          sort: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([mockLead]),
          }),
          exec: jest.fn().mockResolvedValue([mockLead]),
        }),
        findById: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(mockLead) }),
        findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(mockLead) }),
        create: jest.fn().mockImplementation((dto) => Promise.resolve({ id: 'lead-new-1', ...dto, save: jest.fn() })),
      };

      orgModel = {
        findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
        create: jest.fn().mockResolvedValue({ _id: new Types.ObjectId(), members: [], save: jest.fn() }),
      };

      userModel = {
        findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
        create: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
      };

      salesCrmService = new SalesCrmService(
        leadModel as never,
        orgModel as never,
        userModel as never,
        auditRepo as never,
      );
    });

    it('3.11.3 & 3.11.4: logs phone call and updates lastContactAt and stage', async () => {
      const updated = await salesCrmService.logInteraction('sales-user-1', 'lead-1', {
        summary: 'Discovery call on COBOL modernization scope',
        durationMinutes: 25,
        outcome: 'Interested in demo',
      });

      expect(updated.stage).toBe('CONTACTED');
      expect(mockLead.interactions.length).toBe(1);
      expect(mockLead.lastContactAt).toBeDefined();
      expect(mockLead.save).toHaveBeenCalled();
    });

    it('3.11.5: schedules demo with generated Google Meet link', async () => {
      const updated = await salesCrmService.scheduleDemo('sales-user-1', 'lead-1', {
        title: 'Platform Architecture Walkthrough',
        scheduledAt: new Date(Date.now() + 86400000).toISOString(),
      });

      expect(updated.stage).toBe('QUALIFIED');
      expect(mockLead.demos.length).toBe(1);
      expect(mockLead.demos[0].meetLink).toContain('meet.google.com');
    });

    it('3.11.6 & 3.12.3: quote with discount requires Sales Manager approval', async () => {
      const updated = await salesCrmService.sendQuote('sales-user-1', 'lead-1', {
        planName: 'Enterprise Pilot',
        amount: 25000,
        discountPercent: 15,
        discountReason: 'Competitive displacement incentive',
      });

      expect(updated.quotes[0].status).toBe('PENDING_APPROVAL');
      expect(updated.quotes[0].discountApproved).toBe(false);

      // Manager reviews and approves
      leadModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockLead) });
      const approval = await salesCrmService.reviewDiscount(
        'manager-user-1',
        'lead-1',
        updated.quotes[0].id,
        true,
        'Approved within Q4 quota discount budget',
      );

      expect(approval.success).toBe(true);
      expect(mockLead.quotes[0].status).toBe('SENT');
      expect(mockLead.quotes[0].discountApproved).toBe(true);
    });

    it('3.11.7 & 3.11.8: signing contract changes stage to WON and auto-provisions enterprise org', async () => {
      mockLead.contracts = [
        {
          id: 'contract-1',
          documentTitle: 'Master Modernization Agreement',
          status: 'SENT_FOR_SIGNATURE',
        },
      ];

      leadModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockLead) });

      const updated = await salesCrmService.signContract('manager-user-1', 'lead-1', 'contract-1');

      expect(updated.stage).toBe('WON');
      expect(mockLead.contracts[0].status).toBe('SIGNED');
      expect(orgModel.create).toHaveBeenCalled();
      expect(userModel.create).toHaveBeenCalled();
    });

    it('3.12.1: compiles comprehensive sales reports and CSV export', async () => {
      const reports = await salesCrmService.getSalesReports();
      expect(reports.totalLeads).toBe(1);
      expect(reports.pipelineBreakdown).toBeDefined();

      const csv = await salesCrmService.exportSalesReportsCsv();
      expect(csv).toContain('Company,Contact,Email');
      expect(csv).toContain('Fintech Solutions');
    });
  });

  describe('3.13 & 3.14 Platform Administration & User Lifecycle', () => {
    let adminService: PlatformAdminService;
    let userModel: { findById: jest.Mock; find: jest.Mock };
    let sessionModel: { countDocuments: jest.Mock; updateMany: jest.Mock };
    let projectModel: { find: jest.Mock; findById: jest.Mock; updateMany: jest.Mock };
    let orgModel: { findById: jest.Mock };

    beforeEach(() => {
      const targetUser = {
        id: 'user-departing-1',
        _id: new Types.ObjectId(),
        email: 'departing@enterprise.com',
        fullName: 'Departing Staff',
        isActive: true,
        isLocked: false,
        save: jest.fn().mockResolvedValue(true),
      };

      userModel = {
        findById: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(targetUser) }),
        find: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
          exec: jest.fn().mockResolvedValue([targetUser]),
        }),
      };

      sessionModel = {
        countDocuments: jest.fn().mockResolvedValue(3),
        updateMany: jest.fn().mockResolvedValue({ modifiedCount: 3 }),
      };

      projectModel = {
        find: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            id: 'proj-1',
            organizationId: new Types.ObjectId(),
            assignedTeamLeadId: targetUser._id,
            createdBy: targetUser._id,
            save: jest.fn().mockResolvedValue(true),
          }),
        }),
        updateMany: jest.fn().mockResolvedValue({ modifiedCount: 2 }),
      };

      orgModel = {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            id: 'org-1',
            name: 'Acme Corp',
            type: 'ENTERPRISE',
            status: 'ACTIVE',
            save: jest.fn().mockResolvedValue(true),
          }),
        }),
      };

      adminService = new PlatformAdminService(
        orgModel as never,
        userModel as never,
        sessionModel as never,
        {} as never,
        projectModel as never,
        { countDocuments: jest.fn().mockResolvedValue(0) } as never,
        { find: jest.fn().mockReturnValue({ populate: jest.fn().mockReturnValue({ sort: jest.fn().mockReturnValue({ skip: jest.fn().mockReturnValue({ limit: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }) }) }) }) }), countDocuments: jest.fn().mockResolvedValue(0) } as never,
        auditRepo as never,
      );
    });

    it('3.14.2: executes user offboarding workflow, transfers resources and deactivates account', async () => {
      const summary = await adminService.getOffboardingSummary('user-departing-1');
      expect(summary.activeSessionsCount).toBe(3);

      const offboard = await adminService.offboardUser('admin-1', 'user-departing-1');
      expect(offboard.success).toBe(true);
      expect(sessionModel.updateMany).toHaveBeenCalled();
      expect(auditRepo.append).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'USER_OFFBOARDED',
        }),
      );
    });

    it('3.14.3: controlled resource ownership transfer reassigns project with audit log', async () => {
      const newStaff = {
        id: 'user-new-lead',
        _id: new Types.ObjectId(),
        isActive: true,
      };
      userModel.findById.mockImplementation(() => ({
        exec: jest.fn().mockResolvedValue(newStaff),
      }));

      await adminService.transferResource('admin-1', {
        projectId: 'proj-1',
        newAssigneeId: 'user-new-lead',
        reason: 'Project workload rebalancing',
      });

      expect(auditRepo.append).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'RESOURCE_OWNERSHIP_TRANSFERRED',
          resourceType: 'PROJECT',
        }),
      );
    });
  });

  describe('3.15 Temporary Role Management', () => {
    let tempRoleService: TemporaryRoleService;
    let tempRoleModel: {
      findOne: jest.Mock;
      create: jest.Mock;
      findById: jest.Mock;
      find: jest.Mock;
      updateMany: jest.Mock;
    };
    let roleModel: { findOne: jest.Mock };
    let userModel: { findById: jest.Mock };

    beforeEach(() => {
      tempRoleModel = {
        findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
        create: jest.fn().mockImplementation((dto) => Promise.resolve({ id: 'temp-1', ...dto, save: jest.fn() })),
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            id: 'temp-1',
            userId: new Types.ObjectId(),
            roleId: 'TEAM_LEAD',
            status: 'ACTIVE',
            save: jest.fn().mockResolvedValue(true),
          }),
        }),
        find: jest.fn().mockReturnValue({
          populate: jest.fn().mockReturnValue({
            populate: jest.fn().mockReturnValue({
              sort: jest.fn().mockReturnValue({
                exec: jest.fn().mockResolvedValue([
                  {
                    id: 'temp-1',
                    userId: { fullName: 'Staff User' },
                    roleId: 'TEAM_LEAD',
                    durationHours: 8,
                    status: 'ACTIVE',
                    reason: 'Covering on-call rotation',
                  },
                ]),
              }),
            }),
          }),
        }),
        updateMany: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      };

      roleModel = {
        findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ id: 'TEAM_LEAD', name: 'Team Lead' }) }),
      };

      userModel = {
        findById: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }) }),
      };

      tempRoleService = new TemporaryRoleService(
        tempRoleModel as never,
        userModel as never,
        roleModel as never,
        auditRepo as never,
      );
    });

    it('3.15.1: enforces business rules (max 24h, no Admin role, 1 active per user)', async () => {
      // Rule 1: Max 24 hours
      await expect(
        tempRoleService.grantTemporaryRole('admin-1', 'user-1', 'TEAM_LEAD', 25, 'Too long'),
      ).rejects.toThrow();

      // Rule 2: Cannot grant Platform Admin
      await expect(
        tempRoleService.grantTemporaryRole('admin-1', 'user-1', 'SYSTEM_ADMIN', 8, 'Admin escalation'),
      ).rejects.toThrow('Temporary role cannot grant Platform Admin privileges');

      // Successful grant
      const granted = await tempRoleService.grantTemporaryRole(
        'admin-1',
        'user-1',
        'TEAM_LEAD',
        8,
        'Covering shift',
      );
      expect(granted.status).toBe('ACTIVE');
      expect(granted.expiresAt).toBeDefined();

      // Rule 3: Only 1 active temporary role per user
      tempRoleModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(granted) });
      await expect(
        tempRoleService.grantTemporaryRole('admin-1', 'user-1', 'CONVERSION_STAFF', 4, 'Second role'),
      ).rejects.toThrow('The user already holds an active temporary role');
    });

    it('3.15.3: revokes temporary role with reason and audit log', async () => {
      const revoked = await tempRoleService.revokeTemporaryRole('admin-1', 'temp-1', 'Shift ended early');
      expect(revoked.status).toBe('REVOKED');
      expect(auditRepo.append).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'TEMPORARY_ROLE_REVOKED',
        }),
      );
    });

    it('3.15.4: exports immutable temporary role history as CSV', async () => {
      const csv = await tempRoleService.exportHistoryCsv();
      expect(csv).toContain('User,Role,DurationHours');
      expect(csv).toContain('TEAM_LEAD');
      expect(csv).toContain('Covering on-call rotation');
    });

    it('3.16.7: cron job expires temporary roles with expired timestamps', async () => {
      const res = await tempRoleService.expireTemporaryRolesCron();
      expect(res.expiredCount).toBe(1);
      expect(tempRoleModel.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'ACTIVE' }),
        expect.objectContaining({ $set: { status: 'EXPIRED' } }),
      );
    });

    it('unions active temporary role permissions into EffectivePermissionsService immediately', async () => {
      const rbacRepo = {
        findUserRoles: jest.fn().mockResolvedValue(['CONVERSION_STAFF']),
        findUserById: jest.fn().mockResolvedValue({ id: 'user-1', isPlatformAdmin: false }),
        findRolePermissionsByRoleIds: jest.fn().mockImplementation((roleIds: string[]) => {
          const perms: string[] = [];
          if (roleIds.includes('CONVERSION_STAFF')) perms.push('conversions.view');
          if (roleIds.includes('TEAM_LEAD')) perms.push('teams.manage', 'users.manage');
          return Promise.resolve(perms);
        }),
      };

      const mockTempModel = {
        find: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([
            { roleId: 'TEAM_LEAD', status: 'ACTIVE', expiresAt: new Date(Date.now() + 3600000) },
          ]),
        }),
      };

      const effectivePermsService = new EffectivePermissionsService(
        rbacRepo as never,
        mockTempModel as never,
      );

      const perms = await effectivePermsService.getEffectivePermissions('user-1');
      expect(perms).toContain('conversions.view');
      expect(perms).toContain('teams.manage');
      expect(perms).toContain('users.manage');
    });
  });
});
