import { EffectivePermissionsService } from '../src/modules/rbac/application/effective-permissions.service';

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

    const service = new EffectivePermissionsService(
      userRoleModel as never,
      rolePermissionModel as never,
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

    const service = new EffectivePermissionsService(
      userRoleModel as never,
      rolePermissionModel as never,
      userModel as never,
    );

    const roles = await service.getUserRoles('admin-1');
    expect(roles).toContain('ADMIN');
  });
});
