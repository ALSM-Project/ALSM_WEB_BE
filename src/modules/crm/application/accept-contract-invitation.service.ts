import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { USER_REPOSITORY, UserRepository } from '../../users/domain/user.repository';
import { PublicInvitationRateLimitService } from './public-invitation-rate-limit.service';
import {
  CONTRACT_INVITATION_UNIT_OF_WORK,
  ContractInvitationUnitOfWork,
} from './contract-invitation-unit-of-work.port';

@Injectable()
export class AcceptContractInvitationService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(CONTRACT_INVITATION_UNIT_OF_WORK)
    private readonly unitOfWork: ContractInvitationUnitOfWork,
    private readonly rateLimit: PublicInvitationRateLimitService,
  ) {}

  async execute(input: { userId: string; invitationToken: string; clientAddress?: string }) {
    await this.rateLimit.assertAllowed(input.clientAddress, 'accept', 10);
    const user = await this.users.findById(input.userId);
    if (!user || !user.isActive || !user.isEmailVerified) {
      throw new UnauthorizedException({
        code: 'VERIFIED_ACCOUNT_REQUIRED',
        message: 'Sign in with an active account whose email has been verified before accepting this invitation.',
      });
    }
    if (!/^[a-f\d]{64}$/i.test(input.invitationToken ?? '')) throw this.unavailable();
    const grant = await this.unitOfWork.run(async ({ invitations, audit }) => {
      const accepted = await invitations.acceptAndGrant({
        tokenHash: createHash('sha256').update(input.invitationToken).digest('hex'),
        userId: user.id,
        email: user.email.trim().toLowerCase(),
        now: new Date(),
      });
      if (accepted) {
        await audit.appendOnce(`contract-invitation:${accepted.grant.invitationId}:accepted`, {
          actorUserId: user.id,
          action: 'CONTRACT_INVITATION_ACCEPTED',
          resourceType: 'CONTRACT_ACCESS_GRANT',
          resourceId: accepted.grant.id,
          metadata: { leadId: accepted.grant.leadId, invitationId: accepted.grant.invitationId },
        });
      }
      return accepted;
    }, 'contract-invitation-accept');
    if (!grant) throw this.unavailable();
    return {
      grantId: grant.grant.id,
      leadId: grant.grant.leadId,
      phoneVerificationStatus: grant.grant.phoneVerificationStatus,
      signingEligibility: grant.grant.signingEligibility,
      message: 'Invitation accepted. Phone verification is still required before any future signing step.',
    };
  }

  private unavailable(): BadRequestException {
    return new BadRequestException({
      code: 'INVITATION_UNAVAILABLE',
      message: 'This invitation is invalid, expired, revoked, already used, or does not belong to this account.',
    });
  }
}
