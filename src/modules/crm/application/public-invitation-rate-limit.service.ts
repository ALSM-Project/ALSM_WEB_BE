import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { CONTRACT_INVITATION_REPOSITORY, ContractInvitationRepository } from '../domain/contract-invitation.types';

const WINDOW_MS = 60_000;

@Injectable()
export class PublicInvitationRateLimitService {
  constructor(
    @Inject(CONTRACT_INVITATION_REPOSITORY)
    private readonly invitations: ContractInvitationRepository,
  ) {}

  async assertAllowed(clientAddress: string | undefined, action: string, limit: number): Promise<void> {
    const count = await this.invitations.consumePublicRateLimit({
      clientAddress: clientAddress || 'unknown',
      action,
      now: new Date(),
      windowMs: WINDOW_MS,
    });
    if (count > limit) {
      throw new HttpException(
        {
          code: 'INVITATION_RATE_LIMITED',
          message: 'Too many attempts. Wait a minute and try again.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
