import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  PROJECT_STAFF_ALLOCATED,
  ProjectStaffAllocationService,
} from '../src/modules/projects/application/project-staff-allocation.service';

const project = { id: 'p1', organizationId: 'org-a', name: 'ACME', isExported: false };
const user = (id: string, roles: string[], isLocked = false) => ({
  id,
  email: `${id}@alsm.io`,
  fullName: `Person ${id}`,
  isPlatformAdmin: false,
  isLocked,
  roles,
});

describe('ProjectStaffAllocationService (UC-86)', () => {
  const projects = { findById: jest.fn(), findAll: jest.fn(), assignStaff: jest.fn() };
  const audit = { append: jest.fn() };
  const rbac = { getAllUsers: jest.fn() };
  const service = new ProjectStaffAllocationService(projects as never, audit as never, rbac as never);

  beforeEach(() => {
    jest.resetAllMocks();
    projects.findById.mockResolvedValue(project);
    projects.assignStaff.mockImplementation(async (id: string, s: { staffId: string; staffName: string }) => ({
      ...project,
      id,
      assignedStaffId: s.staffId,
      assignedStaffName: s.staffName,
    }));
    rbac.getAllUsers.mockResolvedValue([
      user('marcus', ['CONVERSION_STAFF']),
      user('locked', ['CONVERSION_STAFF'], true),
      user('sales', ['SALES_REP']),
      user('lead', ['TEAM_LEAD']),
    ]);
  });

  describe('listAssignableStaff', () => {
    it('lists only active Conversion Staff, with the projects each one carries', async () => {
      projects.findAll.mockResolvedValue([
        { ...project, id: 'a', assignedStaffId: 'marcus' },
        { ...project, id: 'b', assignedStaffId: 'marcus' },
        { ...project, id: 'c', assignedStaffId: 'marcus', isExported: true },
        { ...project, id: 'd' },
      ]);
      const staff = await service.listAssignableStaff();
      expect(staff).toEqual([
        { id: 'marcus', fullName: 'Person marcus', email: 'marcus@alsm.io', role: 'CONVERSION_STAFF', activeWorkload: 2 },
      ]);
    });
  });

  describe('assign', () => {
    it('stores the allocation and audits who assigned what to whom with the note', async () => {
      const result = await service.assign('lead', 'p1', 'marcus', '  Do the balance screens first  ');

      expect(projects.assignStaff).toHaveBeenCalledWith('p1', {
        staffId: 'marcus',
        staffName: 'Person marcus',
        note: 'Do the balance screens first',
        assignedBy: 'lead',
      });
      expect(result).toMatchObject({ assignedStaffId: 'marcus', assignedStaffName: 'Person marcus' });
      expect(audit.append).toHaveBeenCalledWith({
        actorUserId: 'lead',
        organizationId: 'org-a',
        action: PROJECT_STAFF_ALLOCATED,
        resourceType: 'PROJECT',
        resourceId: 'p1',
        metadata: { staffId: 'marcus', note: 'Do the balance screens first' },
      });
    });

    it('records the previous owner when the project is reallocated', async () => {
      projects.findById.mockResolvedValue({ ...project, assignedStaffId: 'old-owner' });
      await service.assign('lead', 'p1', 'marcus');
      expect(audit.append).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: expect.objectContaining({ previousStaffId: 'old-owner' }) }),
      );
    });

    it.each([
      ['a locked account', 'locked', 'STAFF_NOT_ACTIVE'],
      ['a user with another role', 'sales', 'STAFF_ROLE_INVALID'],
      ['a Team Lead', 'lead', 'STAFF_ROLE_INVALID'],
      ['someone who does not exist', 'ghost', 'STAFF_NOT_FOUND'],
    ])('refuses %s without changing anything', async (_label, staffId, code) => {
      const error = await service.assign('lead', 'p1', staffId).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({ code });
      expect(projects.assignStaff).not.toHaveBeenCalled();
      expect(audit.append).not.toHaveBeenCalled();
    });

    it('refuses an unknown project and an over-long note', async () => {
      projects.findById.mockResolvedValue(null);
      await expect(service.assign('lead', 'nope', 'marcus')).rejects.toBeInstanceOf(NotFoundException);

      projects.findById.mockResolvedValue(project);
      await expect(service.assign('lead', 'p1', 'marcus', 'x'.repeat(1001))).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(projects.assignStaff).not.toHaveBeenCalled();
    });
  });
});
