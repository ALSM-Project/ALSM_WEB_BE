import { BadRequestException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { createHash, randomUUID } from 'node:crypto';
import { EMAIL_VERIFICATION_PORT, EmailVerificationPort } from '../../auth/domain/email-verification.port';
import { USER_REPOSITORY, UserRepository } from '../../users/domain/user.repository';
import { CONTRACT_INVITATION_REPOSITORY, ContractInvitationRepository } from '../domain/contract-invitation.types';
import { PublicInvitationRateLimitService } from './public-invitation-rate-limit.service';
import {
  CONTRACT_INVITATION_UNIT_OF_WORK,
  ContractInvitationUnitOfWork,
} from './contract-invitation-unit-of-work.port';

const CLAIM_LEASE_MS = 5 * 60 * 1000;
const GENERIC_RESULT = {
  accepted: true,
  message: 'If the invitation can be used, sign in with the invited account or verify the email to continue.',
};

@Injectable()
export class RegisterProspectService {
  constructor(
    @Inject(CONTRACT_INVITATION_REPOSITORY) private readonly invitations: ContractInvitationRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(EMAIL_VERIFICATION_PORT) private readonly emailVerification: EmailVerificationPort,
    @Inject(CONTRACT_INVITATION_UNIT_OF_WORK)
    private readonly unitOfWork: ContractInvitationUnitOfWork,
    private readonly rateLimit: PublicInvitationRateLimitService,
  ) {}

  async execute(input: {
    invitationToken: string;
    fullName: string;
    password: string;
    clientAddress?: string;
  }) {
    await this.rateLimit.assertAllowed(input.clientAddress, 'register', 10);
    const tokenHash = this.hashToken(input.invitationToken);
    const invitation = await this.invitations.findActiveByTokenHash(tokenHash, new Date());
    if (!invitation) throw this.unavailable();

    // Do not mutate, reset, or disclose an account that already owns this email.
    const existingUser = await this.users.findByEmail(invitation.email);
    if (existingUser) {
      if (invitation.registrationUserId === existingUser.id) {
        await this.unitOfWork.run(({ audit }) => audit.appendOnce(
          `contract-invitation:${invitation.id}:prospect-created`,
          {
            actorUserId: existingUser.id,
            action: 'PROSPECT_ACCOUNT_CREATED',
            resourceType: 'USER',
            resourceId: existingUser.id,
            metadata: { invitationId: invitation.id, leadId: invitation.leadId },
          },
        ), `prospect-registration-audit:${invitation.id}`);
      }
      return GENERIC_RESULT;
    }

    const now = new Date();
    const claimId = randomUUID();
    const claimed = await this.unitOfWork.run(async ({ invitations, audit }) => {
      const result = await invitations.claimRegistration({
        tokenHash,
        claimId,
        now,
        claimExpiresAt: new Date(now.getTime() + CLAIM_LEASE_MS),
      });
      if (result) {
        await audit.appendOnce(`contract-invitation:${result.id}:registration-claim:${claimId}`, {
          action: 'PROSPECT_REGISTRATION_CLAIMED',
          resourceType: 'CONTRACT_INVITATION',
          resourceId: result.id,
          metadata: { leadId: result.leadId },
        });
      }
      return result;
    }, `prospect-registration-claim:${invitation.id}`);
    if (!claimed) throw this.unavailable();

    try {
      const passwordHash = await bcrypt.hash(input.password, 12);
      const registration = await this.unitOfWork.run(async ({ invitations, users, audit }) => {
        // Repeat the check in the transaction to serialize against /auth/register races.
        if (await users.findByEmail(claimed.email)) return { created: false as const };
        const user = await users.create({
          email: claimed.email,
          passwordHash,
          fullName: input.fullName.trim(),
          accountType: 'PROSPECT',
          isEmailVerified: false,
          isActive: true,
        });
        const completed = await invitations.completeRegistrationClaim({
          invitationId: claimed.id,
          claimId,
          userId: user.id,
          now: new Date(),
        });
        if (!completed) {
          throw new ServiceUnavailableException({
            code: 'PROSPECT_REGISTRATION_PENDING_RECONCILIATION',
            message: 'Invitation processing could not be confirmed. Sign in or contact support.',
          });
        }
        await audit.appendOnce(`contract-invitation:${claimed.id}:prospect-created`, {
          actorUserId: user.id,
          action: 'PROSPECT_ACCOUNT_CREATED',
          resourceType: 'USER',
          resourceId: user.id,
          metadata: { invitationId: claimed.id, leadId: claimed.leadId },
        });
        return { created: true as const, user };
      }, `prospect-registration:${claimed.id}`);

      if (!registration.created) {
        await this.releaseRegistrationClaim(claimed.id, claimId);
        return GENERIC_RESULT;
      }

      let verificationDelivery = 'UNCONFIRMED';
      try {
        verificationDelivery = await this.emailVerification.sendVerificationEmail(registration.user);
      } catch {
        verificationDelivery = 'FAILED';
      }

      await this.unitOfWork.run(({ audit }) => audit.appendOnce(
        `contract-invitation:${claimed.id}:verification-delivery`,
        {
        actorUserId: registration.user.id,
        action: 'PROSPECT_EMAIL_VERIFICATION_DELIVERY_RECORDED',
        resourceType: 'USER',
        resourceId: registration.user.id,
        metadata: { invitationId: claimed.id, deliveryStatus: verificationDelivery },
        },
      ), `prospect-verification-delivery:${claimed.id}`);
      return GENERIC_RESULT;
    } catch (error) {
      await this.releaseRegistrationClaim(claimed.id, claimId);
      if (this.isDuplicateKey(error)) return GENERIC_RESULT;
      throw error;
    }
  }

  private releaseRegistrationClaim(invitationId: string, claimId: string): Promise<void> {
    return this.unitOfWork.run(async ({ invitations, audit }) => {
      const released = await invitations.releaseRegistrationClaim(invitationId, claimId);
      if (released) {
        await audit.appendOnce(
          `contract-invitation:${invitationId}:registration-claim-released:${claimId}`,
          {
            action: 'PROSPECT_REGISTRATION_CLAIM_RELEASED',
            resourceType: 'CONTRACT_INVITATION',
            resourceId: invitationId,
          },
        );
      }
    }, `prospect-registration-claim-release:${invitationId}`);
  }

  private hashToken(value: string): string {
    if (!/^[a-f\d]{64}$/i.test(value ?? '')) throw this.unavailable();
    return createHash('sha256').update(value).digest('hex');
  }

  private unavailable(): BadRequestException {
    return new BadRequestException({
      code: 'INVITATION_UNAVAILABLE',
      message: 'This invitation is invalid, expired, revoked, or already used.',
    });
  }

  private isDuplicateKey(error: unknown): boolean {
    const code = (error as { code?: number | string })?.code;
    return code === 11000 || code === '11000';
  }
}
