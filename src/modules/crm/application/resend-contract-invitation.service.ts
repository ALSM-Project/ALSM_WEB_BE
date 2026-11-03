import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { EMAIL_PORT, EmailDeliveryStatus, EmailPort } from '../../auth/domain/email.port';
import {
  CONTRACT_INVITATION_REPOSITORY,
  ContractInvitationDeliveryStatus,
  ContractInvitationRepository,
} from '../domain/contract-invitation.types';
import { ContractInvitationAccessService } from './contract-invitation-access.service';
import { contractInvitationEmail } from './contract-invitation-email';
import {
  CONTRACT_INVITATION_UNIT_OF_WORK,
  ContractInvitationUnitOfWork,
} from './contract-invitation-unit-of-work.port';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class ResendContractInvitationService {
  constructor(
    private readonly access: ContractInvitationAccessService,
    private readonly config: ConfigService,
    @Inject(CONTRACT_INVITATION_REPOSITORY)
    private readonly invitations: ContractInvitationRepository,
    @Inject(CONTRACT_INVITATION_UNIT_OF_WORK)
    private readonly unitOfWork: ContractInvitationUnitOfWork,
    @Inject(EMAIL_PORT) private readonly email: EmailPort,
  ) {}

  async execute(input: {
    actorUserId: string;
    organizationId?: string;
    leadId: string;
    invitationId: string;
    requestId: string;
  }) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId ?? '')) {
      throw new ConflictException({ code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Provide a UUID v4 Idempotency-Key.' });
    }
    const { lead, organizationId } = await this.access.requireLeadAccess(
      input.actorUserId,
      input.organizationId,
      input.leadId,
    );
    const current = await this.invitations.findForLead(input.invitationId, lead.id, organizationId);
    if (!current) throw new ConflictException({ code: 'CONTRACT_INVITATION_NOT_FOUND', message: 'Invitation is unavailable.' });
    const now = new Date();
    const plainToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(plainToken).digest('hex');
    const rotated = await this.unitOfWork.run(async ({ invitations, audit }) => {
      const result = await invitations.rotateToken({
        invitationId: current.id,
        leadId: lead.id,
        organizationId,
        requestId: input.requestId,
        tokenHash,
        expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
        now,
      });
      if (result) {
        await audit.appendOnce(
          `contract-invitation:${result.invitation.id}:resend:${input.requestId}`,
          {
          actorUserId: input.actorUserId,
          organizationId,
          action: 'CONTRACT_INVITATION_RESENT',
          resourceType: 'CONTRACT_INVITATION',
          resourceId: result.invitation.id,
          metadata: { leadId: lead.id },
          },
          result.replayed
            ? { createdAtAfter: result.invitation.lastDeliveryAttemptAt }
            : undefined,
        );
      }
      return result;
    }, `contract-invitation-resend:${input.invitationId}:${input.requestId}`);
    if (!rotated) throw new ConflictException({ code: 'CONTRACT_INVITATION_NOT_FOUND', message: 'Invitation is unavailable.' });

    let deliveryStatus = rotated.invitation.deliveryStatus;
    if (!rotated.replayed) {
      try {
        const result: EmailDeliveryStatus | void = await this.email.send(
          contractInvitationEmail(this.config, rotated.invitation.email, plainToken),
        );
        deliveryStatus = result === 'SENT' ? 'SENT' : result === 'NOT_CONFIGURED' ? 'NOT_CONFIGURED' : 'UNCONFIRMED';
      } catch {
        deliveryStatus = 'FAILED';
      }
      await this.unitOfWork.run(async ({ invitations, audit }) => {
        await invitations.updateDelivery({
          invitationId: rotated.invitation.id,
          tokenHash,
          status: deliveryStatus,
          attemptedAt: new Date(),
        });
        await audit.appendOnce(
          `contract-invitation:${rotated.invitation.id}:delivery:${input.requestId}`,
          {
          actorUserId: input.actorUserId,
          organizationId,
          action: 'CONTRACT_INVITATION_DELIVERY_RECORDED',
          resourceType: 'CONTRACT_INVITATION',
          resourceId: rotated.invitation.id,
          metadata: { leadId: lead.id, deliveryStatus },
          },
        );
      }, `contract-invitation-delivery:${rotated.invitation.id}`);
    }
    return {
      id: rotated.invitation.id,
      leadId: lead.id,
      recipientEmail: rotated.invitation.email,
      status: rotated.invitation.status,
      deliveryStatus,
      expiresAt: rotated.invitation.expiresAt,
      replayed: rotated.replayed,
      message: deliveryMessage(deliveryStatus),
    };
  }
}

function deliveryMessage(status: ContractInvitationDeliveryStatus): string {
  if (status === 'SENT') return 'A new invitation email was sent; the previous token is invalid.';
  if (status === 'NOT_CONFIGURED') return 'The token was rotated, but SMTP is not configured and no email was sent.';
  if (status === 'FAILED') return 'The token was rotated, but email delivery failed. Check SMTP before retrying.';
  if (status === 'UNCONFIRMED') return 'The token was rotated, but email delivery was not confirmed.';
  return 'The token was rotated and email delivery is pending.';
}
