import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Types } from 'mongoose';
import { TemporaryRoleService } from '../src/modules/rbac/application/temporary-role.service';
import { TemporaryRoleController } from '../src/modules/rbac/presentation/temporary-role.controller';
import { PERMISSIONS_KEY } from '../src/shared/security/require-permissions.decorator';

describe('UC-92 View Temporary Roles Specification Tests', () => {
  let service: TemporaryRoleService;
  let tempRoleModel: {
    find: jest.Mock;
    findById: jest.Mock;
    findOne: jest.Mock;
  };
  let userModel: { find: jest.Mock; findById: jest.Mock; findOne: jest.Mock };
  let roleModel: { findOne: jest.Mock };
  let teamModel: { find: jest.Mock };
  let userRoleModel: { find: jest.Mock };
  let audit: { append: jest.Mock };

  const adminUserId = new Types.ObjectId().toHexString();
  const teamLeadUserId = new Types.ObjectId().toHexString();
  const otherLeadUserId = new Types.ObjectId().toHexString();
  const teamMemberId = new Types.ObjectId().toHexString();
  const outsiderStaffId = new Types.ObjectId().toHexString();

  const exec = (val: unknown) => ({ exec: jest.fn().mockResolvedValue(val) });

  const createMockRoleDoc = (id: string, userId: string, roleId: string, status: 'ACTIVE' | 'EXPIRED' | 'REVOKED', expiresOffsetMs = 3600000, userObj?: Record<string, unknown>) => ({
    _id: new Types.ObjectId(id),
    id,
    userId: userObj || { _id: new Types.ObjectId(userId), fullName: `User ${userId}`, email: `${userId}@alsm.io` },
    roleId,
    grantedBy: { _id: new Types.ObjectId(adminUserId), fullName: 'Admin User', email: 'admin@alsm.io' },
    durationHours: 4,
    reason: 'Test allocation',
    status,
    expiresAt: new Date(Date.now() + expiresOffsetMs),
    createdAt: new Date(Date.now() - 3600000),
  });

  let mockRecords: ReturnType<typeof createMockRoleDoc>[] = [];

  beforeEach(() => {
    mockRecords = [
      createMockRoleDoc(new Types.ObjectId().toHexString(), teamMemberId, 'CONVERSION_STAFF', 'ACTIVE', 3600000, {
        _id: new Types.ObjectId(teamMemberId),
        fullName: 'Alice Member',
        email: 'alice@alsm.io',
      }),
      createMockRoleDoc(new Types.ObjectId().toHexString(), teamMemberId, 'SUPPORT_STAFF', 'EXPIRED', -3600000, {
        _id: new Types.ObjectId(teamMemberId),
        fullName: 'Alice Member',
        email: 'alice@alsm.io',
      }),
      createMockRoleDoc(new Types.ObjectId().toHexString(), teamMemberId, 'QA_STAFF', 'REVOKED', 3600000, {
        _id: new Types.ObjectId(teamMemberId),
        fullName: 'Alice Member',
        email: 'alice@alsm.io',
      }),
      createMockRoleDoc(new Types.ObjectId().toHexString(), outsiderStaffId, 'CONVERSION_STAFF', 'ACTIVE', 3600000, {
        _id: new Types.ObjectId(outsiderStaffId),
        fullName: 'Bob Outside',
        email: 'bob@alsm.io',
      }),
      createMockRoleDoc(new Types.ObjectId().toHexString(), outsiderStaffId, 'LEAD_SPECIALIST', 'EXPIRED', -7200000, {
        _id: new Types.ObjectId(outsiderStaffId),
        fullName: 'Bob Outside',
        email: 'bob@alsm.io',
      }),
    ];

    tempRoleModel = {
      find: jest.fn().mockImplementation((query: any) => {
        let results = [...mockRecords];
        if (query?.userId?.$in) {
          const allowedStr = query.userId.$in.map((id: any) => id.toString());
          results = results.filter((r) => {
            const uId = (r.userId as any)?._id?.toString() || (r.userId as any)?.toString();
            return allowedStr.includes(uId);
          });
        }
        if (query?.status === 'ACTIVE') {
          results = results.filter((r) => r.status === 'ACTIVE' && new Date(r.expiresAt).getTime() > Date.now());
        } else if (query?.status === 'REVOKED') {
          results = results.filter((r) => r.status === 'REVOKED');
        } else if (query?.status === 'EXPIRED' || (query?.$or && query.$or.some((c: any) => c.status === 'EXPIRED'))) {
          results = results.filter((r) => r.status === 'EXPIRED' || (r.status === 'ACTIVE' && new Date(r.expiresAt).getTime() <= Date.now()));
        }
        return {
          populate: jest.fn().mockReturnValue({
            populate: jest.fn().mockReturnValue({
              populate: jest.fn().mockReturnValue({
                sort: jest.fn().mockReturnValue(exec(results)),
              }),
            }),
          }),
        };
      }),
      findById: jest.fn().mockReturnValue(exec(null)),
      findOne: jest.fn().mockReturnValue(exec(null)),
    };

    userModel = {
      findById: jest.fn().mockImplementation((id: string) => {
        if (id === adminUserId) {
          return exec({ _id: new Types.ObjectId(adminUserId), id: adminUserId, isPlatformAdmin: true, email: 'admin@alsm.io', fullName: 'Admin' });
        }
        if (id === teamLeadUserId) {
          return exec({ _id: new Types.ObjectId(teamLeadUserId), id: teamLeadUserId, isPlatformAdmin: false, email: 'lead@alsm.io', fullName: 'Team Lead' });
        }
        if (id === otherLeadUserId) {
          return exec({ _id: new Types.ObjectId(otherLeadUserId), id: otherLeadUserId, isPlatformAdmin: false, email: 'otherlead@alsm.io', fullName: 'Other Lead' });
        }
        return exec({ _id: new Types.ObjectId(outsiderStaffId), id: outsiderStaffId, isPlatformAdmin: false, email: 'outsider@alsm.io', fullName: 'Outsider' });
      }),
      find: jest.fn().mockImplementation(() => ({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue(exec([
            { _id: new Types.ObjectId(teamMemberId), fullName: 'Alice Member', email: 'alice@alsm.io' },
            { _id: new Types.ObjectId(outsiderStaffId), fullName: 'Bob Outside', email: 'bob@alsm.io' },
          ])),
        }),
      })),
      findOne: jest.fn().mockReturnValue(exec(null)),
    };

    teamModel = {
      find: jest.fn().mockImplementation((query: any) => {
        if (query?.managerIds === teamLeadUserId) {
          return {
            lean: jest.fn().mockReturnValue(exec([
              { _id: new Types.ObjectId(), name: 'Conversion Team A', managerIds: [teamLeadUserId], memberIds: [teamMemberId] },
            ])),
          };
        }
        if (query?.managerIds === otherLeadUserId) {
          return {
            lean: jest.fn().mockReturnValue(exec([
              { _id: new Types.ObjectId(), name: 'Support Team B', managerIds: [otherLeadUserId], memberIds: [outsiderStaffId] },
            ])),
          };
        }
        return {
          lean: jest.fn().mockReturnValue(exec([])),
        };
      }),
    };

    userRoleModel = {
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue(exec([])),
        }),
      }),
    };

    roleModel = {
      findOne: jest.fn().mockReturnValue(exec({ id: 'CONVERSION_STAFF' })),
    };

    audit = {
      append: jest.fn().mockResolvedValue(true),
    };

    service = new TemporaryRoleService(
      tempRoleModel as never,
      userModel as never,
      roleModel as never,
      audit as never,
      userRoleModel as never,
      undefined,
      teamModel as never,
    );
  });

  describe('1. Controller Authorization Guarding', () => {
    it('enforces roles.temporary.view permission on listRoles endpoint', () => {
      const reflector = new Reflector();
      const perms = reflector.get<string[]>(
        PERMISSIONS_KEY,
        TemporaryRoleController.prototype.listRoles,
      );
      expect(perms).toEqual(['roles.temporary.view']);
    });
  });

  describe('2. Actor & Team Lead Scoping Rules (SRS 2 & 7)', () => {
    it('Platform Admin can view temporary roles across the entire system', async () => {
      const results = await service.listTemporaryRoles(adminUserId);
      expect(results).toHaveLength(5);
    });

    it('Team Lead can only view temporary roles belonging to their own team members', async () => {
      const results = await service.listTemporaryRoles(teamLeadUserId);
      expect(results).toHaveLength(3);
      for (const item of results) {
        expect((item.userId as any).fullName).toBe('Alice Member');
      }
    });

    it('Team Lead cannot view temporary roles belonging to another team', async () => {
      const results = await service.listTemporaryRoles(teamLeadUserId);
      const bobRecord = results.find((r) => (r.userId as any).fullName === 'Bob Outside');
      expect(bobRecord).toBeUndefined();
    });

    it('Other Team Lead views only their own team members', async () => {
      const results = await service.listTemporaryRoles(otherLeadUserId);
      expect(results).toHaveLength(2);
      for (const item of results) {
        expect((item.userId as any).fullName).toBe('Bob Outside');
      }
    });

    it('rejects unauthorized actor who is neither Platform Admin nor Team Lead', async () => {
      await expect(
        service.listTemporaryRoles(outsiderStaffId),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('3. Status Filtering (SRS 3.2)', () => {
    it('filters by ACTIVE returns only active non-expired roles', async () => {
      const results = await service.listTemporaryRoles(adminUserId, 'ACTIVE');
      for (const item of results) {
        expect(item.status).toBe('ACTIVE');
      }
    });

    it('filters by EXPIRED returns expired roles', async () => {
      const results = await service.listTemporaryRoles(adminUserId, 'EXPIRED');
      for (const item of results) {
        expect(item.status).toBe('EXPIRED');
      }
    });

    it('filters by REVOKED returns revoked roles', async () => {
      const results = await service.listTemporaryRoles(adminUserId, 'REVOKED');
      for (const item of results) {
        expect(item.status).toBe('REVOKED');
      }
    });

    it('filters by ALL returns all statuses', async () => {
      const results = await service.listTemporaryRoles(adminUserId, 'ALL');
      expect(results.length).toBe(5);
    });

    it('rejects invalid status parameter with BadRequestException', async () => {
      await expect(
        service.listTemporaryRoles(adminUserId, 'UNKNOWN_STATUS'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('4. Search Functionality (SRS 3.3)', () => {
    it('searches by user name', async () => {
      const results = await service.listTemporaryRoles(adminUserId, 'ALL', 'Alice');
      expect(results.length).toBe(3);
      for (const item of results) {
        expect((item.userId as any).fullName).toContain('Alice');
      }
    });

    it('searches by user email', async () => {
      const results = await service.listTemporaryRoles(adminUserId, 'ALL', 'bob@alsm.io');
      expect(results.length).toBe(2);
      for (const item of results) {
        expect((item.userId as any).email).toContain('bob@alsm.io');
      }
    });

    it('searches by role name', async () => {
      const results = await service.listTemporaryRoles(adminUserId, 'ALL', 'QA_STAFF');
      expect(results.length).toBe(1);
      expect(results[0].roleId).toBe('QA_STAFF');
    });

    it('combines search and status filter together', async () => {
      const results = await service.listTemporaryRoles(adminUserId, 'ACTIVE', 'Alice');
      expect(results.length).toBe(1);
      expect(results[0].status).toBe('ACTIVE');
      expect((results[0].userId as any).fullName).toBe('Alice Member');
    });

    it('handles empty or whitespace search input safely', async () => {
      const results = await service.listTemporaryRoles(adminUserId, 'ALL', '   ');
      expect(results.length).toBe(5);
    });
  });

  describe('5. Data Resiliency', () => {
    it('handles missing user or grantor records gracefully without crashing', async () => {
      const validDummyId = new Types.ObjectId().toHexString();
      const recordWithoutUser = {
        _id: new Types.ObjectId(validDummyId),
        id: validDummyId,
        userId: null,
        roleId: 'CONVERSION_STAFF',
        grantedBy: null,
        durationHours: 4,
        reason: 'Missing relations test',
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 3600000),
        createdAt: new Date(Date.now() - 3600000),
      };
      tempRoleModel.find.mockReturnValueOnce({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockReturnValue({
            populate: jest.fn().mockReturnValue({
              sort: jest.fn().mockReturnValue(exec([recordWithoutUser])),
            }),
          }),
        }),
      });

      const results = await service.listTemporaryRoles(adminUserId);
      expect(results).toHaveLength(1);
      expect(results[0].userId).toBeNull();
    });
  });
});
