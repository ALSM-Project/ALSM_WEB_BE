import {
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { CurrentSessionGuard } from '../../../shared/security/current-session.guard';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { PermissionsGuard } from '../../../shared/security/permissions.guard';
import { RequirePermissions } from '../../../shared/security/require-permissions.decorator';
import { CreateContractInvitationService } from '../application/create-contract-invitation.service';
import { ListContractInvitationsService } from '../application/list-contract-invitations.service';
import { ResendContractInvitationService } from '../application/resend-contract-invitation.service';
import { RevokeContractInvitationService } from '../application/revoke-contract-invitation.service';

@ApiTags('CRM Contract Invitations')
@ApiBearerAuth()
@ApiHeader({ name: 'x-organization-id', required: false })
@UseGuards(JwtAuthGuard, CurrentSessionGuard, PermissionsGuard)
@RequirePermissions('sales.leads.manage')
@Controller('sales/crm/leads')
export class ContractInvitationsController {
  constructor(
    private readonly createInvitation: CreateContractInvitationService,
    private readonly listInvitations: ListContractInvitationsService,
    private readonly resendInvitation: ResendContractInvitationService,
    private readonly revokeInvitation: RevokeContractInvitationService,
  ) {}

  @Post(':leadId/contract-invitations')
  @ApiOperation({ summary: 'Create an invitation for the contact email on a Lead' })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'UUID v4 reused only for an identical retry' })
  @ApiResponse({ status: 201, description: 'Invitation created; response includes actual email delivery status' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string,
    @Headers('idempotency-key') requestId: string,
    @Param('leadId') leadId: string,
  ) {
    return this.createInvitation.execute({ actorUserId: user.userId, organizationId, requestId, leadId });
  }

  @Get(':leadId/contract-invitations')
  @RequirePermissions('sales.leads.view')
  @ApiOperation({ summary: 'List invitation status for a Lead in the caller’s Sales team scope' })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string,
    @Param('leadId') leadId: string,
  ) {
    return this.listInvitations.execute({ actorUserId: user.userId, organizationId, leadId });
  }

  @Post(':leadId/contract-invitations/:invitationId/resend')
  @ApiOperation({ summary: 'Rotate the invitation token and send a new email' })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'UUID v4 reused only for an identical retry' })
  async resend(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string,
    @Headers('idempotency-key') requestId: string,
    @Param('leadId') leadId: string,
    @Param('invitationId') invitationId: string,
  ) {
    return this.resendInvitation.execute({
      actorUserId: user.userId,
      organizationId,
      requestId,
      leadId,
      invitationId,
    });
  }

  @Delete(':leadId/contract-invitations/:invitationId')
  @ApiOperation({ summary: 'Revoke an active invitation for a Lead' })
  @ApiResponse({ status: 200, description: 'Invitation revoked or already revoked' })
  async revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string,
    @Param('leadId') leadId: string,
    @Param('invitationId') invitationId: string,
  ) {
    return this.revokeInvitation.execute({ actorUserId: user.userId, organizationId, leadId, invitationId });
  }
}
