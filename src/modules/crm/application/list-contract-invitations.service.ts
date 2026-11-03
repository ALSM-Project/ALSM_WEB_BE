import { Inject, Injectable } from '@nestjs/common';
import { ContractInvitationAccessService } from './contract-invitation-access.service';
import { CONTRACT_INVITATION_REPOSITORY, ContractInvitationRepository } from '../domain/contract-invitation.types';

@Injectable()
export class ListContractInvitationsService {
  constructor(
    private readonly access: ContractInvitationAccessService,
    @Inject(CONTRACT_INVITATION_REPOSITORY)
    private readonly invitations: ContractInvitationRepository,
  ) {}

  async execute(input: { actorUserId: string; organizationId?: string; leadId: string }) {
    const { lead, organizationId } = await this.access.requireLeadAccess(
      input.actorUserId,
      input.organizationId,
      input.leadId,
      'sales.leads.view',
    );
    const rows = await this.invitations.listForLead(lead.id, organizationId);
    return rows.map((item) => ({
      id: item.id,
      leadId: item.leadId,
      recipientEmail: item.email,
      status: item.status,
      deliveryStatus: item.deliveryStatus,
      expiresAt: item.expiresAt,
      createdAt: item.createdAt,
      revokedAt: item.revokedAt,
      consumedAt: item.consumedAt,
    }));
  }
}
