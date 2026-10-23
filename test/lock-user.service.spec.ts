import { NotFoundException } from '@nestjs/common';
import { LockUserService } from '../src/modules/admin/application/lock-user.service';
import { EmailPort } from '../src/modules/auth/domain/email.port';
import { AuditRepository } from '../src/modules/audit/domain/audit.repository';

describe('LockUserService (UC 3.13.9)', () => {
  let userModel: { findById: jest.Mock };
  let sessionModel: { updateMany: jest.Mock };
  let audit: jest.Mocked<AuditRepository>;
  let email: jest.Mocked<EmailPort>;
  let service: LockUserService;

  beforeEach(() => {
    userModel = {
      findById: jest.fn().mockReturnValue({ exec: jest.fn() }),
    };
    sessionModel = { updateMany: jest.fn() };
    audit = { append: jest.fn() } as unknown as jest.Mocked<AuditRepository>;
    email = { send: jest.fn() } as unknown as jest.Mocked<EmailPort>;

    service = new LockUserService(userModel as never, sessionModel as never, audit, email);
  });

  it('throws not-found when the target user does not exist', async () => {
    userModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

    await expect(
      service.lock({ actorUserId: 'admin-1', targetUserId: 'missing', reason: 'violation' }),
    ).rejects.toThrow(NotFoundException);
    expect(audit.append).not.toHaveBeenCalled();
  });

  it('locks the user, revokes sessions, sends email, and writes audit', async () => {
    const save = jest.fn().mockResolvedValue(true);
    const user: Record<string, unknown> = {
      _id: 'user-1',
      id: 'user-1',
      email: 'staff@acmecorp.com',
      fullName: 'Staff Member',
      isLocked: false,
      save,
    };
    userModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(user) });
    sessionModel.updateMany.mockResolvedValue({});

    const result = await service.lock({
      actorUserId: 'admin-1',
      targetUserId: 'user-1',
      reason: 'Suspected security breach',
      duration: '7 days',
    });

    expect(user.isLocked).toBe(true);
    expect(user.lockReason).toBe('Suspected security breach');
    expect(user.lockDuration).toBe('7 days');
    expect(save).toHaveBeenCalled();
    expect(sessionModel.updateMany).toHaveBeenCalled();
    expect(email.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'staff@acmecorp.com' }),
    );
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'USER_ACCOUNT_LOCKED', resourceId: 'user-1' }),
    );
    expect(result.success).toBe(true);
  });

  it('unlocks the user and clears lock fields', async () => {
    const save = jest.fn().mockResolvedValue(true);
    const user: Record<string, unknown> = {
      _id: 'user-1',
      id: 'user-1',
      email: 'staff@acmecorp.com',
      fullName: 'Staff Member',
      isLocked: true,
      lockReason: 'violation',
      lockDuration: '7 days',
      lockedAt: new Date(),
      lockedBy: 'admin-1',
      save,
    };
    userModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(user) });

    const result = await service.unlock('admin-1', 'user-1');

    expect(user.isLocked).toBe(false);
    expect(user.lockReason).toBeUndefined();
    expect(user.lockDuration).toBeUndefined();
    expect(save).toHaveBeenCalled();
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'USER_ACCOUNT_UNLOCKED' }),
    );
    expect(result.success).toBe(true);
  });
});
