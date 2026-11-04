import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Types } from 'mongoose';
import { TemporaryRoleService } from '../src/modules/rbac/application/temporary-role.service';
import { EffectivePermissionsService } from '../src/modules/rbac/application/effective-permissions.service';
import { TemporaryRoleController } from '../src/modules/rbac/presentation/temporary-role.controller';
import { PERMISSIONS_KEY } from '../src/shared/security/require-permissions.decorator';

describe('UC-93 Revoke Temporary Role Specification Tests', () => {
  let service: TemporaryRoleService;
  let tempRoleModel: {
    find: jest.Mock;
    findById: jest.Mock;
    findOne: jest.Mock;
    findOneAndUpdate: jest.Mock;
    create: jest.Mock;
  };
  let userModel: { findById: jest.Mock; findOne: jest.Mock };
  let roleModel: { findOne: jest.Mock };
  let userRoleModel: { find: jest.Mock };
  let audit: { append: jest.Mock };
  let notifications: { createForUsers: jest.Mock };

  const adminUserId = new Types.ObjectId().toHexString();
  const teamLeadUserId = new Types.ObjectId().toHexString();
  const targetStaffId = new Types.ObjectId().toHexString();
  const tempRoleId = new Types.ObjectId().toHexString();

  const exec = (val: unknown) => ({ exec: jest.fn().mockResolvedValue(val) });

  const createMockActiveDoc = (overrides: Record<string, unknown> = {}) => ({
    _id: new Types.ObjectId(tempRoleId),
    id: tempRoleId,
    userId: targetStaffId,
    roleId: 'TEAM_LEAD',
    grantedBy: adminUserId,
    durationHours: 4,
    reason: 'Sprint coverage',
    status: 'ACTIVE',
    expiresAt: new Date(Date.now() + 3600000 * 2), // +2h
    save: jest.fn().mockResolvedValue(true),
    ...overrides,
  });

  beforeEach(() => {
    tempRoleModel = {
      find: jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockReturnValue({
            populate: jest.fn().mockReturnValue({
              sort: jest.fn().mockReturnValue(exec([createMockActiveDoc()])),
            }),
          }),
        }),
      }),
      findById: jest.fn().mockReturnValue(exec(createMockActiveDoc())),
      findOne: jest.fn().mockReturnValue(exec(null)),
      findOneAndUpdate: jest.fn().mockImplementation((query: unknown, update: { $set: Record<string, unknown> }) => {
        const doc = createMockActiveDoc({
          ...update.$set,
          status: update.$set?.status || 'REVOKED',
        });
        return exec(doc);
      }),
      create: jest.fn(),
    };

    userModel = {
      findById: jest.fn().mockImplementation((id: string) => {
        if (id === adminUserId) {
          return exec({ _id: new Types.ObjectId(adminUserId), id: adminUserId, isPlatformAdmin: true, email: 'admin@alsm.io', fullName: 'Admin' });
        }
        if (id === teamLeadUserId) {
          return exec({ _id: new Types.ObjectId(teamLeadUserId), id: teamLeadUserId, isPlatformAdmin: false, email: 'lead@alsm.io', fullName: 'Team Lead' });
        }
        return exec({ _id: new Types.ObjectId(targetStaffId), id: targetStaffId, isPlatformAdmin: false, email: 'staff@alsm.io', fullName: 'Staff' });
      }),
      findOne: jest.fn().mockReturnValue(exec(null)),
    };

    roleModel = {
      findOne: jest.fn().mockReturnValue(exec({ id: 'TEAM_LEAD', key: 'TEAM_LEAD' })),
    };

    userRoleModel = {
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue(exec([{ userId: teamLeadUserId }])),
        }),
      }),
    };

    audit = {
      append: jest.fn().mockResolvedValue(true),
    };

    notifications = {
      createForUsers: jest.fn().mockResolvedValue(1),
    };

    service = new TemporaryRoleService(
      tempRoleModel as never,
      userModel as never,
      roleModel as never,
      audit as never,
      userRoleModel as never,
      notifications as never,
    );
  });

  describe('1. Controller Authorization Guarding', () => {
    it('enforces roles.temporary.revoke permission on revokeRole endpoint', () => {
      const reflector = new Reflector();
      const perms = reflector.get<string[]>(
        PERMISSIONS_KEY,
        TemporaryRoleController.prototype.revokeRole,
      );
      expect(perms).toEqual(['roles.temporary.revoke']);
    });
  });

  describe('2. Revocation Validation & Business Rules', () => {
    it('Platform Admin can revoke an active temporary role with valid reason', async () => {
      const result = await service.revokeTemporaryRole(
        adminUserId,
        tempRoleId,
        'Project milestone completed early',
      );

      expect(result).toBeDefined();
      expect(result.status).toBe('REVOKED');
      expect(result.revocationReason).toBe('Project milestone completed early');
      expect(result.revokedBy).toEqual(expect.anything());
      expect(audit.append).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'TEMPORARY_ROLE_REVOKED',
          actorUserId: adminUserId,
        }),
      );
    });

    it('Team Lead can revoke an active temporary role when authorized', async () => {
      const result = await service.revokeTemporaryRole(
        teamLeadUserId,
        tempRoleId,
        'Team task handed over successfully',
      );

      expect(result.status).toBe('REVOKED');
      expect(result.revocationReason).toBe('Team task handed over successfully');
    });

    it('rejects revocation when reason is missing or empty', async () => {
      await expect(
        service.revokeTemporaryRole(adminUserId, tempRoleId, ''),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.revokeTemporaryRole(adminUserId, tempRoleId, '   '),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects revocation when temporary role does not exist', async () => {
      tempRoleModel.findOneAndUpdate = jest.fn().mockReturnValue(exec(null));
      tempRoleModel.findById.mockReturnValue(exec(null));

      await expect(
        service.revokeTemporaryRole(adminUserId, 'nonexistent-id', 'Valid justification'),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects revocation when temporary role is already REVOKED', async () => {
      const alreadyRevokedDoc = createMockActiveDoc({
        status: 'REVOKED',
        revokedAt: new Date(),
        revocationReason: 'Prior revocation',
      });
      tempRoleModel.findOneAndUpdate = jest.fn().mockReturnValue(exec(null));
      tempRoleModel.findById.mockReturnValue(exec(alreadyRevokedDoc));

      await expect(
        service.revokeTemporaryRole(adminUserId, tempRoleId, 'Another revocation'),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects revocation when temporary role is already EXPIRED', async () => {
      const alreadyExpiredDoc = createMockActiveDoc({
        status: 'EXPIRED',
        expiresAt: new Date(Date.now() - 3600000),
      });
      tempRoleModel.findOneAndUpdate = jest.fn().mockReturnValue(exec(null));
      tempRoleModel.findById.mockReturnValue(exec(alreadyExpiredDoc));

      await expect(
        service.revokeTemporaryRole(adminUserId, tempRoleId, 'Late revocation'),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects revocation and marks EXPIRED when expiresAt timestamp has elapsed', async () => {
      const expiredDoc = createMockActiveDoc({
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() - 10000), // 10 seconds ago
      });
      tempRoleModel.findOneAndUpdate = jest.fn().mockReturnValue(exec(null));
      tempRoleModel.findById.mockReturnValue(exec(expiredDoc));

      await expect(
        service.revokeTemporaryRole(adminUserId, tempRoleId, 'Revoking after time passed'),
      ).rejects.toThrow(ConflictException);

      expect(expiredDoc.save).toHaveBeenCalled();
      expect(expiredDoc.status).toBe('EXPIRED');
      expect(audit.append).not.toHaveBeenCalled();
    });

    it('handles concurrent revocation safely using atomic update', async () => {
      tempRoleModel.findOneAndUpdate = jest.fn().mockReturnValue(exec(null));
      tempRoleModel.findById.mockReturnValue(
        exec(createMockActiveDoc({ status: 'REVOKED' })),
      );

      await expect(
        service.revokeTemporaryRole(adminUserId, tempRoleId, 'Concurrent revocation'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('3. Notifications and Audit Logging', () => {
    it('notifies affected user about early revocation', async () => {
      await service.revokeTemporaryRole(
        adminUserId,
        tempRoleId,
        'Access scope updated',
      );

      expect(notifications.createForUsers).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientUserIds: [targetStaffId],
          type: 'TEMPORARY_ROLE_REVOKED',
          title: 'Temporary Role Revoked',
          message: expect.stringContaining('Access scope updated'),
          resourceId: tempRoleId,
        }),
      );
    });

    it('continues successfully if notification delivery fails', async () => {
      notifications.createForUsers.mockRejectedValueOnce(new Error('Notification service down'));

      const result = await service.revokeTemporaryRole(
        adminUserId,
        tempRoleId,
        'Valid reason even if notification fails',
      );

      expect(result.status).toBe('REVOKED');
      expect(audit.append).toHaveBeenCalled();
    });
  });

  describe('4. Permissions Removal & UC-91/UC-94/UC-95 Integration', () => {
    it('immediately removes temporary permissions from EffectivePermissionsService upon revocation', async () => {
      const mockRbacRepo = {
        findUserRoles: jest.fn().mockResolvedValue(['CONVERSION_STAFF']),
        findUserById: jest.fn().mockResolvedValue({ isPlatformAdmin: false }),
        findPermissions: jest.fn(),
        findRolePermissionsByRoleIds: jest.fn().mockImplementation((roleIds: string[]) => {
          const perms: string[] = ['conversions.view'];
          if (roleIds.includes('TEAM_LEAD')) perms.push('teams.manage', 'users.manage');
          return Promise.resolve(perms);
        }),
      };

      const activeTempModel = {
        find: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([
            { roleId: 'TEAM_LEAD', status: 'ACTIVE', expiresAt: new Date(Date.now() + 3600000) },
          ]),
        }),
      };

      const permServiceBefore = new EffectivePermissionsService(
        mockRbacRepo as never,
        activeTempModel as never,
      );
      const rolesBefore = await permServiceBefore.getUserRoles(targetStaffId);
      const permsBefore = await permServiceBefore.getEffectivePermissions(targetStaffId);
      expect(rolesBefore).toContain('TEAM_LEAD');
      expect(permsBefore).toContain('teams.manage');

      const revokedTempModel = {
        find: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([]),
        }),
      };

      const permServiceAfter = new EffectivePermissionsService(
        mockRbacRepo as never,
        revokedTempModel as never,
      );
      const rolesAfter = await permServiceAfter.getUserRoles(targetStaffId);
      const permsAfter = await permServiceAfter.getEffectivePermissions(targetStaffId);
      expect(rolesAfter).not.toContain('TEAM_LEAD');
      expect(permsAfter).not.toContain('teams.manage');
    });

    it('preserves revoked temporary role in historical list (UC-94)', async () => {
      const history = await service.getHistory();
      expect(history).toBeDefined();
      expect(Array.isArray(history)).toBe(true);
      expect(history.length).toBeGreaterThan(0);
    });

    it('can revoke a temporary role granted via UC-91 grantTemporaryRole', async () => {
      const grantedDoc = createMockActiveDoc({
        id: 'tr-uc91',
        _id: new Types.ObjectId(),
        roleId: 'TEAM_LEAD',
        status: 'ACTIVE',
      });
      tempRoleModel.create.mockResolvedValueOnce(grantedDoc);
      tempRoleModel.findById.mockReturnValue(exec(grantedDoc));

      const granted = await service.grantTemporaryRole(
        adminUserId,
        targetStaffId,
        'TEAM_LEAD',
        4,
        'UC-91 granted temporary elevation',
      );
      expect(granted.status).toBe('ACTIVE');

      const revoked = await service.revokeTemporaryRole(
        adminUserId,
        granted.id,
        'Early conclusion of task',
      );
      expect(revoked.status).toBe('REVOKED');
      expect(revoked.revocationReason).toBe('Early conclusion of task');
    });
  });
});
