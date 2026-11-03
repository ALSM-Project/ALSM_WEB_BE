import { Inject, Injectable } from '@nestjs/common';
import {
  CONTRACT_INVITATION_UNIT_OF_WORK,
  ContractInvitationUnitOfWork,
} from './contract-invitation-unit-of-work.port';
import { ContractInvitationAccessService } from './contract-invitation-access.service';

@Injectable()
export class RevokeContractInvitationService {
  constructor(
    private readonly access: ContractInvitationAccessService,
    @Inject(CONTRACT_INVITATION_UNIT_OF_WORK)
    private readonly unitOfWork: ContractInvitationUnitOfWork,
  ) {}

  async execute(input: {
    actorUserId: string;
    organizationId?: string;
    leadId: string;
    invitationId: string;
  }) {
    const { lead, organizationId } = await this.access.requireLeadAccess(
      input.actorUserId,
      input.organizationId,
      input.leadId,
    );
    const result = await this.unitOfWork.run(async ({ invitations, audit }) => {
      const revoked = await invitations.revoke({
        invitationId: input.invitationId,
        leadId: lead.id,
        organizationId,
        now: new Date(),
      });
      if (revoked?.invitation.status === 'REVOKED') {
        await audit.appendOnce(`contract-invitation:${revoked.invitation.id}:revoked`, {
          actorUserId: input.actorUserId,
          organizationId,
          action: 'CONTRACT_INVITATION_REVOKED',
          resourceType: 'CONTRACT_INVITATION',
          resourceId: revoked.invitation.id,
          metadata: { leadId: lead.id },
        });
      }
      return revoked;
    }, `contract-invitation-revoke:${input.invitationId}`);
    if (!result) return { revoked: false };
    return { id: result.invitation.id, revoked: result.invitation.status === 'REVOKED', replayed: !result.changed };
  }
}
