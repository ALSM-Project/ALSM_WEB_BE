import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { createHash } from 'node:crypto';
import { EMAIL_PORT, EmailDeliveryStatus, EmailPort } from '../../auth/domain/email.port';
import {
  CONTRACT_INVITATION_UNIT_OF_WORK,
  ContractInvitationUnitOfWork,
} from './contract-invitation-unit-of-work.port';
import {
  ContractInvitationDeliveryStatus,
} from '../domain/contract-invitation.types';
import { ContractInvitationAccessService, requireLeadEmail } from './contract-invitation-access.service';
import { contractInvitationEmail } from './contract-invitation-email';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class CreateContractInvitationService {
  constructor(
    private readonly access: ContractInvitationAccessService,
    private readonly config: ConfigService,
    @Inject(CONTRACT_INVITATION_UNIT_OF_WORK)
    private readonly unitOfWork: ContractInvitationUnitOfWork,
    @Inject(EMAIL_PORT) private readonly email: EmailPort,
  ) {}

  async execute(input: {
    actorUserId: string;
    organizationId?: string;
    leadId: string;
    requestId: string;
  }) {
    this.requireRequestId(input.requestId);
    const { lead, organizationId } = await this.access.requireLeadAccess(
      input.actorUserId,
      input.organizationId,
      input.leadId,
    );
    const email = requireLeadEmail(lead);
    const now = new Date();
    const plainToken = randomBytes(32).toString('hex');
    const tokenHash = this.hash(plainToken);
    const result = await this.unitOfWork.run(async ({ invitations, audit }) => {
      const expired = await invitations.expireExpiredForLeadEmail(lead.id, email, now);
      for (const item of expired) {
        await audit.appendOnce(`contract-invitation:${item.id}:expired`, {
          actorUserId: input.actorUserId,
          organizationId: item.organizationId,
          action: 'CONTRACT_INVITATION_EXPIRED',
          resourceType: 'CONTRACT_INVITATION',
          resourceId: item.id,
          metadata: { leadId: item.leadId },
        });
      }
      const created = await invitations.createOrReplay({
        leadId: lead.id,
        organizationId,
        email,
        createdByUserId: input.actorUserId,
        requestId: input.requestId,
        tokenHash,
        expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
        now,
      });
      await audit.appendOnce(`contract-invitation:${created.invitation.id}:created`, {
        actorUserId: input.actorUserId,
        organizationId,
        action: 'CONTRACT_INVITATION_CREATED',
        resourceType: 'CONTRACT_INVITATION',
        resourceId: created.invitation.id,
        metadata: { leadId: lead.id },
      });
      return created;
    }, `contract-invitation-create:${input.requestId}`);
    if (!result.replayed) {
      const deliveryStatus = await this.deliver({
        invitationId: result.invitation.id,
        tokenHash,
        email,
        plainToken,
        requestId: input.requestId,
        actorUserId: input.actorUserId,
        organizationId,
        leadId: lead.id,
      });
      result.invitation.deliveryStatus = deliveryStatus;
    }
    return this.present(result.invitation, result.replayed);
  }

  private async deliver(input: {
    invitationId: string;
    tokenHash: string;
    email: string;
    plainToken: string;
    requestId: string;
    actorUserId: string;
    organizationId: string;
    leadId: string;
  }): Promise<ContractInvitationDeliveryStatus> {
    let status: ContractInvitationDeliveryStatus;
    try {
      const result: EmailDeliveryStatus | void = await this.email.send(
        contractInvitationEmail(this.config, input.email, input.plainToken),
      );
      status = result === 'SENT' ? 'SENT' : result === 'NOT_CONFIGURED' ? 'NOT_CONFIGURED' : 'UNCONFIRMED';
    } catch {
      status = 'FAILED';
    }
    await this.unitOfWork.run(async ({ invitations, audit }) => {
      await invitations.updateDelivery({
        invitationId: input.invitationId,
        tokenHash: input.tokenHash,
        status,
        attemptedAt: new Date(),
      });
      await audit.appendOnce(`contract-invitation:${input.invitationId}:delivery:${input.requestId}`, {
        actorUserId: input.actorUserId,
        organizationId: input.organizationId,
        action: 'CONTRACT_INVITATION_DELIVERY_RECORDED',
        resourceType: 'CONTRACT_INVITATION',
        resourceId: input.invitationId,
        metadata: { leadId: input.leadId, deliveryStatus: status },
      });
    }, `contract-invitation-delivery:${input.invitationId}`);
    return status;
  }

  private present(invitation: {
    id: string;
    leadId: string;
    email: string;
    status: string;
    deliveryStatus: ContractInvitationDeliveryStatus;
    expiresAt: Date;
  }, replayed: boolean) {
    const message = invitation.deliveryStatus === 'SENT'
      ? 'Invitation was sent by email.'
      : invitation.deliveryStatus === 'NOT_CONFIGURED'
        ? 'Invitation is saved, but SMTP is not configured and no email was sent. Configure SMTP, then resend.'
        : invitation.deliveryStatus === 'FAILED'
          ? 'Invitation is saved, but email delivery failed. Resend after checking SMTP.'
          : invitation.deliveryStatus === 'UNCONFIRMED'
            ? 'Invitation is saved, but the email adapter did not confirm delivery. Check SMTP and resend if needed.'
            : 'Invitation is saved and delivery is pending.';
    return {
      id: invitation.id,
      leadId: invitation.leadId,
      recipientEmail: invitation.email,
      status: invitation.status,
      deliveryStatus: invitation.deliveryStatus,
      expiresAt: invitation.expiresAt,
      replayed,
      message,
    };
  }

  private requireRequestId(value: string): void {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value ?? '')) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: 'Provide a UUID v4 Idempotency-Key for this invitation request.',
      });
    }
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
