import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Types } from 'mongoose';
import { TemporaryRoleService } from '../src/modules/rbac/application/temporary-role.service';
import { EffectivePermissionsService } from '../src/modules/rbac/application/effective-permissions.service';
import { TemporaryRoleController } from '../src/modules/rbac/presentation/temporary-role.controller';
import { PERMISSIONS_KEY } from '../src/shared/security/require-permissions.decorator';

const exec = <T>(value: T) => ({ exec: jest.fn().mockResolvedValue(value) });

describe('UC-93 Revoke Temporary Role Specification Tests', () => {
  let tempRoleModel: Record<string, jest.Mock>;
  let userModel: Record<string, jest.Mock>;
  let roleModel: Record<string, jest.Mock>;
  let userRoleModel: Record<string, jest.Mock>;
  let audit: { append: jest.Mock };
  let notifications: { createForUsers: jest.Mock };
  let service: TemporaryRoleService;

  const adminUserId = new Types.ObjectId().toString();
  const teamLeadUserId = new Types.ObjectId().toString();
  const targetStaffId = new Types.ObjectId().toString();
  const tempRoleId = new Types.ObjectId().toString();

  const createMockActiveDoc = (overrides?: Record<string, unknown>) => {
    const futureDate = new Date(Date.now() + 8 * 3600 * 1000);
    const doc: Record<string, unknown> = {
      id: tempRoleId,
      _id: new Types.ObjectId(tempRoleId),
      userId: new Types.ObjectId(targetStaffId),
      roleId: 'TEAM_LEAD',
      durationHours: 8,
      status: 'ACTIVE',
      grantedBy: new Types.ObjectId(adminUserId),
      grantedAt: new Date(),
      expiresAt: futureDate,
      reason: 'Urgent weekend operational coverage',
      save: jest.fn().mockResolvedValue(true),
      ...overrides,
    };
    return doc;
  };

  beforeEach(() => {
    const activeDoc = createMockActiveDoc();

    tempRoleModel = {
      findById: jest.fn().mockReturnValue(exec(activeDoc)),
      findOne: jest.fn().mockReturnValue(exec(null)),
      find: jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockReturnValue({
            sort: jest.fn().mockReturnValue(exec([activeDoc])),
          }),
        }),
      }),
      create: jest.fn().mockImplementation(async (dto: Record<string, unknown>) => ({
        id: 'tr-new',
        _id: new Types.ObjectId(),
        save: jest.fn().mockResolvedValue(true),
        ...dto,
      })),
      findOneAndUpdate: jest.fn().mockImplementation((filter: { status?: string }, update: { $set?: { revocationReason?: string; revokedBy?: Types.ObjectId } }) => {
        if (filter.status === 'ACTIVE') {
          return {
            exec: jest.fn().mockResolvedValue({
              ...activeDoc,
              status: 'REVOKED',
              revokedAt: new Date(),
              revokedBy: update?.$set?.revokedBy ?? new Types.ObjectId(adminUserId),
              revocationReason: update?.$set?.revocationReason ?? 'Revoked',
            }),
          };
        }
        return { exec: jest.fn().mockResolvedValue(null) };
      }),
      updateMany: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };

    userModel = {
      findById: jest.fn().mockReturnValue(exec({
        _id: targetStaffId,
        fullName: 'Conversion Specialist',
        email: 'specialist@alsm.dev',
        isActive: true,
        isLocked: false,
        isPlatformAdmin: false,
      })),
    };

    roleModel = {
      findOne: jest.fn().mockReturnValue(exec({
        id: 'TEAM_LEAD',
        name: 'Team Lead',
      })),
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
      expect(result.revokedAt).toBeDefined();
      expect(audit.append).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'TEMPORARY_ROLE_REVOKED',
          actorUserId: adminUserId,
          resourceId: tempRoleId,
          metadata: expect.objectContaining({
            previousStatus: 'ACTIVE',
            resultingStatus: 'REVOKED',
            reason: 'Project milestone completed early',
          }),
        }),
      );
    });

    it('Team Lead can revoke an active temporary role when authorized', async () => {
      const result = await service.revokeTemporaryRole(
        teamLeadUserId,
        tempRoleId,
        'Shift coverage handover completed',
      );

      expect(result).toBeDefined();
      expect(result.status).toBe('REVOKED');
      expect(result.revocationReason).toBe('Shift coverage handover completed');
      expect(audit.append).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'TEMPORARY_ROLE_REVOKED',
          actorUserId: teamLeadUserId,
        }),
      );
    });

    it('rejects revocation when reason is missing or empty', async () => {
      await expect(
        service.revokeTemporaryRole(adminUserId, tempRoleId, ''),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.revokeTemporaryRole(adminUserId, tempRoleId, '   '),
      ).rejects.toThrow(BadRequestException);

      expect(audit.append).not.toHaveBeenCalled();
    });

    it('rejects revocation when temporary role does not exist', async () => {
      tempRoleModel.findOneAndUpdate = jest.fn().mockReturnValue(exec(null));
      tempRoleModel.findById.mockReturnValue(exec(null));

      await expect(
        service.revokeTemporaryRole(adminUserId, new Types.ObjectId().toString(), 'Some reason'),
      ).rejects.toThrow(NotFoundException);

      expect(audit.append).not.toHaveBeenCalled();
    });

    it('rejects revocation when temporary role is already REVOKED', async () => {
      tempRoleModel.findOneAndUpdate = jest.fn().mockReturnValue(exec(null));
      tempRoleModel.findById.mockReturnValue(
        exec(createMockActiveDoc({ status: 'REVOKED' })),
      );

      await expect(
        service.revokeTemporaryRole(adminUserId, tempRoleId, 'Repeated attempt'),
      ).rejects.toThrow(ConflictException);

      expect(audit.append).not.toHaveBeenCalled();
    });

    it('rejects revocation when temporary role is already EXPIRED', async () => {
      tempRoleModel.findOneAndUpdate = jest.fn().mockReturnValue(exec(null));
      tempRoleModel.findById.mockReturnValue(
        exec(createMockActiveDoc({ status: 'EXPIRED' })),
      );

      await expect(
        service.revokeTemporaryRole(adminUserId, tempRoleId, 'Late revocation'),
      ).rejects.toThrow(ConflictException);

      expect(audit.append).not.toHaveBeenCalled();
    });

    it('rejects revocation and marks EXPIRED when expiresAt timestamp has elapsed', async () => {
      tempRoleModel.findOneAndUpdate = jest.fn().mockReturnValue(exec(null));
      const expiredDoc = createMockActiveDoc({
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() - 3600 * 1000), // 1 hour ago
      });
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
});
