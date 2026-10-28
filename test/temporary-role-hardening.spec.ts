import { Reflector } from '@nestjs/core';
import { Types } from 'mongoose';
import { PERMISSIONS_KEY } from '../src/shared/security/require-permissions.decorator';
import { TemporaryRoleController } from '../src/modules/rbac/presentation/temporary-role.controller';
import { TemporaryRoleService } from '../src/modules/rbac/application/temporary-role.service';

const exec = <T>(value: T) => ({ exec: jest.fn().mockResolvedValue(value) });
const REASON = 'Fixing the production incident';

describe('Temporary role routes are permission-guarded (UC-91)', () => {
  const reflector = new Reflector();
  const required = (handler: keyof TemporaryRoleController) =>
    reflector.get<string[]>(PERMISSIONS_KEY, TemporaryRoleController.prototype[handler] as never);

  it.each([
    ['grantRole', 'roles.temporary.grant'],
    ['listRoles', 'roles.temporary.view'],
    ['revokeRole', 'roles.temporary.revoke'],
    ['getHistory', 'roles.temporary.history.view'],
    ['exportHistoryCsv', 'roles.temporary.history.view'],
    ['requestRole', 'roles.temporary.request'],
    ['reviewRequest', 'roles.temporary.requests.review'],
    ['expireRoles', 'roles.temporary.manage'],
  ] as const)('%s needs %s', (handler, permission) => {
    expect(required(handler)).toEqual([permission]);
  });
});

describe('TemporaryRoleService business rules (UC-91)', () => {
  const tempRoleModel = { findOne: jest.fn(), create: jest.fn(), findById: jest.fn() };
  const roleModel = { findOne: jest.fn() };
  const userModel = { findById: jest.fn() };
  const audit = { append: jest.fn() };
  const service = new TemporaryRoleService(
    tempRoleModel as never,
    userModel as never,
    roleModel as never,
    audit as never,
  );
  const target = new Types.ObjectId().toString();
  const actor = new Types.ObjectId().toString();

  beforeEach(() => {
    jest.resetAllMocks();
    roleModel.findOne.mockReturnValue(exec({ id: 'CONVERSION_STAFF' }));
    userModel.findById.mockReturnValue(exec({ _id: target, isLocked: false }));
    tempRoleModel.findOne.mockReturnValue(exec(null));
    tempRoleModel.create.mockImplementation(async (dto: object) => ({ id: 'tr-1', ...dto }));
  });

  describe('grant', () => {
    it.each([[0.5], [0], [-1], [25], [Number.NaN]])('refuses a duration of %s hours', async (hours) => {
      await expect(service.grantTemporaryRole(actor, target, 'CONVERSION_STAFF', hours, REASON)).rejects.toThrow(
        /between 1 and 24 hours/,
      );
      expect(tempRoleModel.create).not.toHaveBeenCalled();
    });

    it.each([[1], [4], [8], [12], [24]])('accepts %s hours', async (hours) => {
      const granted = await service.grantTemporaryRole(actor, target, 'CONVERSION_STAFF', hours, REASON);
      expect(granted.durationHours).toBe(hours);
      expect(granted.expiresAt.getTime() - granted.grantedAt.getTime()).toBe(hours * 3600 * 1000);
    });

    it('requires a justification of at least 10 characters', async () => {
      await expect(
        service.grantTemporaryRole(actor, target, 'CONVERSION_STAFF', 4, '  too short '),
      ).rejects.toMatchObject({ response: { code: 'JUSTIFICATION_TOO_SHORT' } });
    });

    it.each([['SYSTEM_ADMIN'], ['admin'], ['Platform_Admin']])('never grants %s', async (role) => {
      await expect(service.grantTemporaryRole(actor, target, role, 4, REASON)).rejects.toThrow(
        'Temporary role cannot grant Platform Admin privileges',
      );
    });

    it('does not let anyone grant a role to themselves, or to a locked account', async () => {
      await expect(service.grantTemporaryRole(actor, actor, 'TEAM_LEAD', 4, REASON)).rejects.toThrow(
        'cannot grant a temporary role to yourself',
      );
      userModel.findById.mockReturnValue(exec({ _id: target, isLocked: true }));
      await expect(service.grantTemporaryRole(actor, target, 'CONVERSION_STAFF', 4, REASON)).rejects.toThrow(
        'locked account',
      );
    });

    it('records the project scope and the exact start and end in the audit trail', async () => {
      const projectId = new Types.ObjectId().toString();
      const granted = await service.grantTemporaryRole(actor, target, 'CONVERSION_STAFF', 8, REASON, projectId);
      expect(granted.projectId?.toString()).toBe(projectId);
      expect(audit.append).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'TEMPORARY_ROLE_GRANTED',
          metadata: expect.objectContaining({
            targetUserId: target,
            roleId: 'CONVERSION_STAFF',
            projectId,
            reason: REASON,
            grantedAt: granted.grantedAt.toISOString(),
            expiresAt: granted.expiresAt.toISOString(),
          }),
        }),
      );
    });
  });

  describe('revoke', () => {
    const record = (status: string) => ({
      id: 'tr-1',
      userId: new Types.ObjectId(),
      roleId: 'TEAM_LEAD',
      status,
      save: jest.fn().mockResolvedValue(true),
    });

    it('revokes an active role with a reason and audits it', async () => {
      tempRoleModel.findById.mockReturnValue(exec(record('ACTIVE')));
      const revoked = await service.revokeTemporaryRole(actor, 'tr-1', ' Work finished early ');
      expect(revoked.status).toBe('REVOKED');
      expect(revoked.revocationReason).toBe('Work finished early');
      expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({ action: 'TEMPORARY_ROLE_REVOKED' }));
    });

    it.each([['EXPIRED'], ['REVOKED']])('cannot revoke a role that is already %s', async (status) => {
      tempRoleModel.findById.mockReturnValue(exec(record(status)));
      await expect(service.revokeTemporaryRole(actor, 'tr-1', 'because')).rejects.toMatchObject({
        response: { code: 'TEMPORARY_ROLE_NOT_ACTIVE' },
      });
      expect(audit.append).not.toHaveBeenCalled();
    });

    it('needs a reason', async () => {
      tempRoleModel.findById.mockReturnValue(exec(record('ACTIVE')));
      await expect(service.revokeTemporaryRole(actor, 'tr-1', '   ')).rejects.toMatchObject({
        response: { code: 'REVOCATION_REASON_REQUIRED' },
      });
    });
  });

  describe('request and review', () => {
    const pending = (overrides: Record<string, unknown> = {}) => ({
      id: 'req-1',
      userId: new Types.ObjectId(target),
      roleId: 'CONVERSION_STAFF',
      durationHours: 4,
      requestStatus: 'PENDING',
      status: 'REVOKED',
      save: jest.fn().mockResolvedValue(true),
      ...overrides,
    });

    it('applies the same duration and justification rules to a request', async () => {
      await expect(service.requestTemporaryRole(target, 'CONVERSION_STAFF', 0.5, REASON)).rejects.toThrow(/between 1 and 24/);
      await expect(service.requestTemporaryRole(target, 'CONVERSION_STAFF', 4, 'short')).rejects.toMatchObject({
        response: { code: 'JUSTIFICATION_TOO_SHORT' },
      });
    });

    it('approves a pending request: the role starts then and ends after its duration', async () => {
      const doc = pending();
      tempRoleModel.findById.mockReturnValue(exec(doc));
      const approved = await service.reviewRequest(actor, 'req-1', true);
      expect(approved.status).toBe('ACTIVE');
      expect(approved.expiresAt.getTime() - approved.grantedAt.getTime()).toBe(4 * 3600 * 1000);
    });

    it('does not review a request twice, review your own, or approve over a role the user already has', async () => {
      tempRoleModel.findById.mockReturnValue(exec(pending({ requestStatus: 'APPROVED' })));
      await expect(service.reviewRequest(actor, 'req-1', true)).rejects.toMatchObject({
        response: { code: 'REQUEST_ALREADY_REVIEWED' },
      });

      tempRoleModel.findById.mockReturnValue(exec(pending()));
      await expect(service.reviewRequest(target, 'req-1', true)).rejects.toThrow('your own');

      tempRoleModel.findById.mockReturnValue(exec(pending()));
      tempRoleModel.findOne.mockReturnValue(exec({ id: 'other-active' }));
      await expect(service.reviewRequest(actor, 'req-1', true)).rejects.toMatchObject({
        response: { code: 'ACTIVE_TEMPORARY_ROLE_EXISTS' },
      });
    });

    it('needs a reason to reject', async () => {
      tempRoleModel.findById.mockReturnValue(exec(pending()));
      await expect(service.reviewRequest(actor, 'req-1', false, ' ')).rejects.toMatchObject({
        response: { code: 'REJECTION_REASON_REQUIRED' },
      });
    });
  });
});
