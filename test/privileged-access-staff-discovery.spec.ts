import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { TemporaryRoleService } from '../src/modules/rbac/application/temporary-role.service';
import { TemporaryRole } from '../src/modules/rbac/infrastructure/schemas/temporary-role.schema';
import { User } from '../src/modules/users/infrastructure/user.schema';
import { Role } from '../src/modules/rbac/infrastructure/schemas/role.schema';
import { UserRole } from '../src/modules/rbac/infrastructure/schemas/user-role.schema';
import { AUDIT_REPOSITORY } from '../src/modules/audit/domain/audit.repository';
import { RBAC_REPOSITORY } from '../src/modules/rbac/domain/rbac.repository.interface';
import { Types } from 'mongoose';

describe('Privileged Access Management (PAM) Staff Discovery & Elevation', () => {
  let service: TemporaryRoleService;

  const mockAdminId = new Types.ObjectId().toString();
  const mockStaffEligibleId = new Types.ObjectId().toString();
  const mockStaffLockedId = new Types.ObjectId().toString();
  const mockStaffWithActiveRoleId = new Types.ObjectId().toString();

  const mockUsers = [
    {
      _id: new Types.ObjectId(mockAdminId),
      fullName: 'System Administrator',
      email: 'admin@alsm.io',
      isPlatformAdmin: true,
      isActive: true,
      isLocked: false,
    },
    {
      _id: new Types.ObjectId(mockStaffEligibleId),
      fullName: 'Alice Walker',
      email: 'alice.walker@alsm.io',
      isPlatformAdmin: false,
      isActive: true,
      isLocked: false,
    },
    {
      _id: new Types.ObjectId(mockStaffLockedId),
      fullName: 'Bob SecurityHold',
      email: 'bob.locked@alsm.io',
      isPlatformAdmin: false,
      isActive: true,
      isLocked: true,
      lockReason: 'Suspicious credential activity',
    },
    {
      _id: new Types.ObjectId(mockStaffWithActiveRoleId),
      fullName: 'Charlie ActiveRole',
      email: 'charlie@alsm.io',
      isPlatformAdmin: false,
      isActive: true,
      isLocked: false,
    },
  ];

  const mockUserRoles = [
    { userId: mockStaffEligibleId, roleId: 'CONVERSION_STAFF' },
    { userId: mockStaffLockedId, roleId: 'CONVERSION_STAFF' },
    { userId: mockStaffWithActiveRoleId, roleId: 'CONVERSION_STAFF' },
  ];

  const mockActiveTempRoles = [
    {
      _id: new Types.ObjectId(),
      userId: new Types.ObjectId(mockStaffWithActiveRoleId),
      roleId: 'TEAM_LEAD',
      status: 'ACTIVE',
      durationHours: 8,
      expiresAt: new Date(Date.now() + 6 * 3600 * 1000),
      reason: 'Urgent queue supervisor coverage',
    },
  ];

  const mockRoles = [
    {
      _id: new Types.ObjectId(),
      id: 'TEAM_LEAD',
      name: 'Team Lead',
      description: 'Supervisory role with assignment authority',
      isSystem: true,
    },
    {
      _id: new Types.ObjectId(),
      id: 'CONVERSION_STAFF',
      name: 'Conversion Staff',
      description: 'Core modernization engineer',
      isSystem: true,
    },
    {
      _id: new Types.ObjectId(),
      id: 'ADMIN',
      name: 'Platform Admin',
      description: 'Platform superuser',
      isSystem: true,
    },
  ];

  const mockTempRoleModel = {
    find: jest.fn().mockReturnValue({
      exec: jest.fn().mockImplementation(() => Promise.resolve(mockActiveTempRoles)),
    }),
    findOne: jest.fn(),
    create: jest.fn(),
  };

  const mockUserModel = {
    find: jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(mockUsers),
    }),
    findById: jest.fn().mockImplementation((id: any) => ({
      exec: jest.fn().mockResolvedValue(mockUsers.find((u) => u._id.toString() === id.toString())),
    })),
  };

  const mockRoleModel = {
    find: jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(mockRoles),
    }),
    findOne: jest.fn(),
  };

  const mockUserRoleModel = {
    find: jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(mockUserRoles),
    }),
  };

  const mockAuditRepo = {
    append: jest.fn().mockResolvedValue({ id: 'aud-1' }),
  };

  const mockRbacRepo = {
    findRolePermissions: jest.fn().mockResolvedValue(['projects.allocate', 'quality.review']),
    findRolePermissionsByRoleIds: jest.fn().mockResolvedValue(['conversions.view']),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TemporaryRoleService,
        { provide: getModelToken(TemporaryRole.name), useValue: mockTempRoleModel },
        { provide: getModelToken(User.name), useValue: mockUserModel },
        { provide: getModelToken(Role.name), useValue: mockRoleModel },
        { provide: getModelToken(UserRole.name), useValue: mockUserRoleModel },
        { provide: AUDIT_REPOSITORY, useValue: mockAuditRepo },
        { provide: RBAC_REPOSITORY, useValue: mockRbacRepo },
      ],
    }).compile();

    service = module.get<TemporaryRoleService>(TemporaryRoleService);
  });

  describe('getEligibleStaff', () => {
    it('discovers internal staff and correctly calculates PAM eligibility', async () => {
      const result = await service.getEligibleStaff(mockAdminId, {
        page: 1,
        limit: 10,
      });

      expect(result.items.length).toBeGreaterThan(0);
      expect(result.total).toBe(4);

      // Admin user cannot elevate self
      const adminItem = result.items.find((i) => i.id === mockAdminId);
      expect(adminItem).toBeDefined();
      expect(adminItem?.isEligible).toBe(false);
      expect(adminItem?.ineligibilityReason).toContain('Cannot grant temporary role to yourself');

      // Alice is eligible
      const aliceItem = result.items.find((i) => i.id === mockStaffEligibleId);
      expect(aliceItem).toBeDefined();
      expect(aliceItem?.isEligible).toBe(true);
      expect(aliceItem?.ineligibilityReason).toBeNull();
      expect(aliceItem?.department).toBeDefined();

      // Bob is locked -> ineligible
      const bobItem = result.items.find((i) => i.id === mockStaffLockedId);
      expect(bobItem).toBeDefined();
      expect(bobItem?.isEligible).toBe(false);
      expect(bobItem?.accountStatus).toBe('LOCKED');
      expect(bobItem?.ineligibilityReason).toContain('Account is locked');

      // Charlie holds active temporary role -> ineligible
      const charlieItem = result.items.find((i) => i.id === mockStaffWithActiveRoleId);
      expect(charlieItem).toBeDefined();
      expect(charlieItem?.isEligible).toBe(false);
      expect(charlieItem?.hasActiveTemporaryRole).toBe(true);
      expect(charlieItem?.ineligibilityReason).toContain('User holds active temporary elevation');
    });

    it('filters staff by search keyword', async () => {
      const result = await service.getEligibleStaff(mockAdminId, {
        search: 'Alice',
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].fullName).toBe('Alice Walker');
    });

    it('filters staff by eligibility status', async () => {
      const result = await service.getEligibleStaff(mockAdminId, {
        eligibility: 'ELIGIBLE',
      });

      expect(result.items.every((i) => i.isEligible)).toBe(true);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe(mockStaffEligibleId);
    });
  });

  describe('getElevationCatalog', () => {
    it('returns available elevation roles excluding Platform Admin', async () => {
      const catalog = await service.getElevationCatalog();

      expect(catalog.length).toBeGreaterThan(0);
      expect(catalog.some((c) => c.code === 'ADMIN' || c.code === 'PLATFORM_ADMIN')).toBe(false);
      const teamLead = catalog.find((c) => c.code === 'TEAM_LEAD');
      expect(teamLead).toBeDefined();
      expect(teamLead?.name).toBe('Team Lead');
      expect(teamLead?.sensitivePermissions).toBeDefined();
    });
  });
});
