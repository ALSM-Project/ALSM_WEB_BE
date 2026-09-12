import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { EffectivePermissionsService } from '../src/modules/rbac/application/effective-permissions.service';
import { RbacService } from '../src/modules/rbac/application/rbac.service';

describe('RBAC & Effective Permissions', () => {
  it('calculates effective permissions as union of assigned roles', async () => {
    const userRoleModel = {
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([
            { roleId: 'CONVERSION_OPERATOR' },
            { roleId: 'REVIEWER' },
          ]),
        }),
      }),
    };

    const rolePermissionModel = {
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([
            { permissionKey: 'conversion.view' },
            { permissionKey: 'conversion.execute' },
            { permissionKey: 'diagnostics.view' },
            { permissionKey: 'diagnostics.review' },
          ]),
        }),
      }),
    };

    const userModel = {
      findById: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({ id: 'user-1', isPlatformAdmin: false }),
      }),
    };

    const permissionModel = {
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([]),
        }),
      }),
    };

    const service = new EffectivePermissionsService(
      userRoleModel as never,
      rolePermissionModel as never,
      permissionModel as never,
      userModel as never,
    );

    const perms = await service.getEffectivePermissions('user-1');
    expect(perms).toEqual([
      'conversion.view',
      'conversion.execute',
      'diagnostics.view',
      'diagnostics.review',
    ]);
  });

  it('automatically attaches ADMIN role for platform admin users', async () => {
    const userRoleModel = {
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([]),
        }),
      }),
    };

    const rolePermissionModel = {
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([
            { permissionKey: 'dashboard.view' },
            { permissionKey: 'system.settings' },
          ]),
        }),
      }),
    };

    const userModel = {
      findById: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({ id: 'admin-1', isPlatformAdmin: true }),
      }),
    };

    const permissionModel = {
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([
            { key: 'dashboard.view' },
            { key: 'system.settings' },
          ]),
        }),
      }),
    };

    const service = new EffectivePermissionsService(
      userRoleModel as never,
      rolePermissionModel as never,
      permissionModel as never,
      userModel as never,
    );

    const roles = await service.getUserRoles('admin-1');
    expect(roles).toContain('ADMIN');
  });

  describe('RbacService Business Logic & Error Validation', () => {

    it('prevents deleting system roles with 403 Forbidden', async () => {
      const roleModel = {
        findOne: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({ id: 'ADMIN', isSystem: true }),
        }),
      };
      const rbacService = new RbacService(
        roleModel as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );

      await expect(rbacService.deleteRole('ADMIN')).rejects.toThrow(ForbiddenException);
    });

    it('prevents deleting custom roles assigned to users with 409 Conflict', async () => {
      const roleModel = {
        findOne: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({ id: 'OPERATOR', isSystem: false }),
        }),
      };
      const userRoleModel = {
        countDocuments: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(2),
        }),
      };
      const rbacService = new RbacService(
        roleModel as never,
        {} as never,
        {} as never,
        userRoleModel as never,
        {} as never,
      );

      await expect(rbacService.deleteRole('OPERATOR')).rejects.toThrow(ConflictException);
    });

    it('rejects updateRolePermissions if any permission key is invalid (400 Bad Request)', async () => {
      const roleModel = {
        findOne: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({ id: 'OPERATOR', isSystem: false }),
        }),
      };
      const permissionModel = {
        find: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([{ key: 'projects.view' }]),
        }),
      };
      const rolePermissionModel = {
        deleteMany: jest.fn(),
        insertMany: jest.fn(),
      };

      const rbacService = new RbacService(
        roleModel as never,
        permissionModel as never,
        rolePermissionModel as never,
        {} as never,
        {} as never,
      );

      await expect(
        rbacService.updateRolePermissions('OPERATOR', ['projects.view', 'INVALID_PERM']),
      ).rejects.toThrow(BadRequestException);

      expect(rolePermissionModel.deleteMany).not.toHaveBeenCalled();
      expect(rolePermissionModel.insertMany).not.toHaveBeenCalled();
    });

    it('creates a custom permission successfully', async () => {
      const permissionModel = {
        findOne: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(null),
        }),
      };
      // Mock class constructor save method
      const PermissionMock = function (this: any, doc: any) {
        Object.assign(this, doc);
        this.save = jest.fn().mockResolvedValue(this);
      } as any;
      PermissionMock.findOne = permissionModel.findOne;

      const rbacService = new RbacService(
        {} as never,
        PermissionMock as never,
        {} as never,
        {} as never,
        {} as never,
      );

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
        save: jest.fn().mockImplementation(function (this: any) {
          return Promise.resolve(this);
        }),
      };
      const permissionModel = {
        findOne: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(mockPerm),
        }),
      };

      const rbacService = new RbacService(
        {} as never,
        permissionModel as never,
        {} as never,
        {} as never,
        {} as never,
      );

      const updated = await rbacService.updatePermission('reports.export', 'New Label', 'New Group', 'New Desc');
      expect(updated.label).toBe('New Label');
      expect(updated.group).toBe('New Group');
      expect(updated.description).toBe('New Desc');
    });

    it('deletes permission and cleans up role assignments', async () => {
      const mockPerm = { key: 'reports.export' };
      const permissionModel = {
        findOne: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(mockPerm),
        }),
        deleteOne: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({ deletedCount: 1 }),
        }),
      };
      const rolePermissionModel = {
        deleteMany: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({ deletedCount: 2 }),
        }),
      };

      const rbacService = new RbacService(
        {} as never,
        permissionModel as never,
        rolePermissionModel as never,
        {} as never,
        {} as never,
      );

      await rbacService.deletePermission('reports.export');
      expect(permissionModel.deleteOne).toHaveBeenCalledWith({ key: 'reports.export' });
      expect(rolePermissionModel.deleteMany).toHaveBeenCalledWith({ permissionKey: 'reports.export' });
    });
  });
});

