import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../../users/infrastructure/user.schema';
import { UserSession, UserSessionDocument } from '../../auth/infrastructure/user-session.schema';
import { AUDIT_REPOSITORY, AuditRepository } from '../../audit/domain/audit.repository';
import { EMAIL_PORT, EmailPort } from '../../auth/domain/email.port';
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
    @Inject(EMAIL_PORT) private readonly email: EmailPort,
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

    // Notify the user that their account has been locked.
    await this.email.send({
      to: user.email,
      subject: 'Your ALSM account has been locked',
      html:
        `<p>Hi ${this.escape(user.fullName)},</p>` +
        `<p>Your account has been locked by an administrator.</p>` +
        `<p>Reason: ${this.escape(input.reason)}</p>` +
        (input.duration
          ? `<p>Lock duration: ${this.escape(input.duration)}</p>`
          : '') +
        `<p>Please contact your administrator if you believe this is a mistake.</p>`,
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

  private escape(value: string): string {
    return value.replace(/[&<>"']/g, (c) => {
      const map: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      };
      return map[c];
    });
  }
}
