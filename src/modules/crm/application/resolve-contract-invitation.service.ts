import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { CONTRACT_INVITATION_REPOSITORY, ContractInvitationRepository } from '../domain/contract-invitation.types';
import { PublicInvitationRateLimitService } from './public-invitation-rate-limit.service';

@Injectable()
export class ResolveContractInvitationService {
  constructor(
    @Inject(CONTRACT_INVITATION_REPOSITORY) private readonly invitations: ContractInvitationRepository,
    private readonly rateLimit: PublicInvitationRateLimitService,
  ) {}

  async execute(invitationToken: string, clientAddress?: string) {
    await this.rateLimit.assertAllowed(clientAddress, 'resolve', 30);
    const tokenHash = this.hashToken(invitationToken);
    const invitation = await this.invitations.findActiveByTokenHash(tokenHash, new Date());
    if (!invitation) throw this.unavailable();
    return {
      status: 'INVITATION_VALID',
      recipientEmail: maskEmail(invitation.email),
      expiresAt: invitation.expiresAt,
      nextAction: 'SIGN_IN_OR_REGISTER_THEN_VERIFY_EMAIL_AND_ACCEPT',
    };
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
}

function maskEmail(value: string): string {
  const [local, domain] = value.split('@');
  if (!local || !domain) return '***';
  const visible = local.length < 3 ? local.slice(0, 1) : local.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(1, local.length - visible.length))}@${domain}`;
}
