import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../../users/infrastructure/user.schema';
import { UserSession, UserSessionDocument } from '../../auth/infrastructure/user-session.schema';
import { AUDIT_REPOSITORY, AuditRepository } from '../../audit/domain/audit.repository';
import { toValidObjectId } from '../../../shared/utils/object-id.util';

export interface LockUserInput {
  actorUserId: string;
  targetUserId: string;
  reason: string;
  duration?: string;
}

export interface LockUserResult {
  success: boolean;
  message: string;
}

// UC 3.13.9 — Lock / Unlock User Account.
// Owns the account-lock workflow: set lock state, revoke active sessions,
// and record an audit entry. Email notification is handled by the caller
// (controller/service) so this service stays focused on persistence.
@Injectable()
export class LockUserService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(UserSession.name) private readonly sessionModel: Model<UserSessionDocument>,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
  ) {}

  async lock(input: LockUserInput): Promise<LockUserResult> {
    const user = await this.userModel.findById(toValidObjectId(input.targetUserId)).exec();
    if (!user) throw new NotFoundException('User not found');

    user.isLocked = true;
    user.lockReason = input.reason;
    user.lockDuration = input.duration;
    user.lockedAt = new Date();
    user.lockedBy = input.actorUserId;
    await user.save();

    // Invalidate all active sessions immediately.
    await this.sessionModel.updateMany(
      { userId: user._id, revokedAt: { $exists: false } },
      { $set: { revokedAt: new Date() } },
    );

    await this.audit.append({
      actorUserId: input.actorUserId,
      action: 'USER_ACCOUNT_LOCKED',
      resourceType: 'USER',
      resourceId: user.id,
      metadata: { email: user.email, reason: input.reason, duration: input.duration ?? '' },
    });

    return { success: true, message: `Account for ${user.email} has been locked.` };
  }

  async unlock(actorUserId: string, targetUserId: string): Promise<LockUserResult> {
    const user = await this.userModel.findById(toValidObjectId(targetUserId)).exec();
    if (!user) throw new NotFoundException('User not found');

    user.isLocked = false;
    user.lockReason = undefined;
    user.lockDuration = undefined;
    user.lockedAt = undefined;
    user.lockedBy = undefined;
    await user.save();

    await this.audit.append({
      actorUserId,
      action: 'USER_ACCOUNT_UNLOCKED',
      resourceType: 'USER',
      resourceId: user.id,
      metadata: { email: user.email },
    });

    return { success: true, message: `Account for ${user.email} has been unlocked.` };
  }
}
