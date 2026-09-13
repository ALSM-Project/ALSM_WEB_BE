import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { EffectivePermissionsService } from '../src/modules/rbac/application/effective-permissions.service';
import { RbacService } from '../src/modules/rbac/application/rbac.service';
import { IRbacRepository } from '../src/modules/rbac/domain/rbac.repository.interface';

describe('RBAC & Effective Permissions', () => {
  it('calculates effective permissions as union of assigned roles', async () => {
    const mockRepo: Partial<IRbacRepository> = {
      findUserRoles: jest.fn().mockResolvedValue(['CONVERSION_OPERATOR', 'REVIEWER']),
      findUserById: jest.fn().mockResolvedValue({ id: 'user-1', isPlatformAdmin: false, email: 'u@test.com', fullName: 'User 1', isActive: true }),
      findRolePermissionsByRoleIds: jest.fn().mockResolvedValue([
        'conversion.view',
        'conversion.execute',
        'diagnostics.view',
        'diagnostics.review',
      ]),
    };

    const service = new EffectivePermissionsService(mockRepo as IRbacRepository);

    const perms = await service.getEffectivePermissions('user-1');
    expect(perms).toEqual([
      'conversion.view',
      'conversion.execute',
      'diagnostics.view',
      'diagnostics.review',
    ]);
  });

  it('automatically attaches ADMIN role for platform admin users', async () => {
    const mockRepo: Partial<IRbacRepository> = {
      findUserRoles: jest.fn().mockResolvedValue([]),
      findUserById: jest.fn().mockResolvedValue({ id: 'admin-1', isPlatformAdmin: true, email: 'admin@test.com', fullName: 'Admin', isActive: true }),
    };

    const service = new EffectivePermissionsService(mockRepo as IRbacRepository);

    const roles = await service.getUserRoles('admin-1');
    expect(roles).toContain('ADMIN');
  });

  describe('RbacService Business Logic & Error Validation', () => {
    it('prevents deleting system roles with 403 Forbidden', async () => {
      const mockRepo: Partial<IRbacRepository> = {
        findRoleById: jest.fn().mockResolvedValue({ id: 'ADMIN', name: 'Admin', description: '', isSystem: true }),
      };
      const rbacService = new RbacService(mockRepo as IRbacRepository);

      await expect(rbacService.deleteRole('ADMIN')).rejects.toThrow(ForbiddenException);
    });

    it('prevents deleting custom roles assigned to users with 409 Conflict', async () => {
      const mockRepo: Partial<IRbacRepository> = {
        findRoleById: jest.fn().mockResolvedValue({ id: 'OPERATOR', name: 'Operator', description: '', isSystem: false }),
        countUsersWithRole: jest.fn().mockResolvedValue(2),
      };
      const rbacService = new RbacService(mockRepo as IRbacRepository);

      await expect(rbacService.deleteRole('OPERATOR')).rejects.toThrow(ConflictException);
    });

    it('rejects updateRolePermissions if any permission key is invalid (400 Bad Request)', async () => {
      const mockRepo: Partial<IRbacRepository> = {
        findRoleById: jest.fn().mockResolvedValue({ id: 'OPERATOR', name: 'Operator', description: '', isSystem: false }),
        findValidPermissions: jest.fn().mockResolvedValue(['projects.view']),
        deleteRolePermissionsByRoleId: jest.fn(),
        updateRolePermissions: jest.fn(),
      };

      const rbacService = new RbacService(mockRepo as IRbacRepository);

      await expect(
        rbacService.updateRolePermissions('OPERATOR', ['projects.view', 'INVALID_PERM']),
      ).rejects.toThrow(BadRequestException);

      expect(mockRepo.updateRolePermissions).not.toHaveBeenCalled();
    });

    it('creates a custom permission successfully', async () => {
      const mockRepo: Partial<IRbacRepository> = {
        findPermissionByKey: jest.fn().mockResolvedValue(null),
        createPermission: jest.fn().mockImplementation(async (data) => ({
          key: data.key,
          label: data.label,
          group: data.group,
          description: data.description,
        })),
      };

      const rbacService = new RbacService(mockRepo as IRbacRepository);

      const created = await rbacService.createPermission('reports export', 'Export Reports', 'Reports', 'Desc');
      expect(created.key).toBe('reports.export');
      expect(created.label).toBe('Export Reports');
    });

    it('updates permission details successfully', async () => {
      const mockPerm = {
        key: 'reports.export',
        label: 'Old Label',
        group: 'Old Group',
        description: 'Old Desc',
      };
      const mockRepo: Partial<IRbacRepository> = {
        findPermissionByKey: jest.fn().mockResolvedValue(mockPerm),
        updatePermission: jest.fn().mockImplementation(async (key, data) => ({
          key,
          label: data.label ?? mockPerm.label,
          group: data.group ?? mockPerm.group,
          description: data.description ?? mockPerm.description,
        })),
      };

      const rbacService = new RbacService(mockRepo as IRbacRepository);

      const updated = await rbacService.updatePermission('reports.export', 'New Label', 'New Group', 'New Desc');
      expect(updated.label).toBe('New Label');
      expect(updated.group).toBe('New Group');
      expect(updated.description).toBe('New Desc');
    });

    it('deletes permission and cleans up role assignments', async () => {
      const mockRepo: Partial<IRbacRepository> = {
        findPermissionByKey: jest.fn().mockResolvedValue({ key: 'reports.export' }),
        deletePermission: jest.fn().mockResolvedValue(undefined),
        deleteRolePermissionsByPermissionKey: jest.fn().mockResolvedValue(undefined),
      };

      const rbacService = new RbacService(mockRepo as IRbacRepository);

      await rbacService.deletePermission('reports.export');
      expect(mockRepo.deletePermission).toHaveBeenCalledWith('reports.export');
      expect(mockRepo.deleteRolePermissionsByPermissionKey).toHaveBeenCalledWith('reports.export');
    });
  });
});
