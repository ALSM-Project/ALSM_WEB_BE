import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { CurrentSessionGuard } from '../../../shared/security/current-session.guard';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { OrganizationMembersService } from '../application/organization-members.service';
import { OrganizationRole } from '../domain/organization.types';

export class InviteMemberDto {
  email!: string;
  name?: string;
  role!: OrganizationRole;
}

export class UpdateMemberRoleDto {
  role!: OrganizationRole;
}

export class UpdateMemberStatusDto {
  status!: 'Active' | 'Locked' | 'Disabled';
  reason?: string;
}

@ApiTags('Organization Members & Invitations')
@ApiBearerAuth()
@ApiHeader({ name: 'x-organization-id', required: false })
@UseGuards(JwtAuthGuard, CurrentSessionGuard)
@Controller()
export class OrganizationMembersController {
  constructor(private readonly membersService: OrganizationMembersService) {}

  @Get('organizations/:organizationId/members')
  @ApiOperation({ summary: 'List customer organization members and pending invitations' })
  @ApiResponse({ status: 200, description: 'Organization members retrieved successfully' })
  async listMembers(
    @CurrentUser() user: AuthenticatedUser,
    @Param('organizationId') organizationId: string,
    @Headers('x-organization-id') organizationIdHeader?: string,
  ) {
    const orgId = organizationId === 'current' ? organizationIdHeader : organizationId;
    return this.membersService.listMembers(user.userId, orgId);
  }

  @Get('organization/members')
  @ApiOperation({ summary: 'List current organization members and pending invitations' })
  @ApiResponse({ status: 200, description: 'Organization members retrieved successfully' })
  async listCurrentMembers(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationIdHeader?: string,
  ) {
    return this.membersService.listMembers(user.userId, organizationIdHeader);
  }

  @Post('organizations/:organizationId/invitations')
  @ApiOperation({ summary: 'Invite a member to the customer organization' })
  @ApiResponse({ status: 201, description: 'Member invited successfully' })
  async inviteMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('organizationId') organizationId: string,
    @Body() input: InviteMemberDto,
    @Headers('x-organization-id') organizationIdHeader?: string,
  ) {
    const orgId = organizationId === 'current' ? organizationIdHeader : organizationId;
    return this.membersService.inviteMember(user.userId, orgId, input);
  }

  @Post('organization/invitations')
  @ApiOperation({ summary: 'Invite a member to the current organization' })
  async inviteCurrentMember(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: InviteMemberDto,
    @Headers('x-organization-id') organizationIdHeader?: string,
  ) {
    return this.membersService.inviteMember(user.userId, organizationIdHeader, input);
  }

  @Post('organizations/:organizationId/invitations/:invitationId/resend')
  @ApiOperation({ summary: 'Resend an invitation email' })
  async resendInvitation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('organizationId') organizationId: string,
    @Param('invitationId') invitationId: string,
    @Headers('x-organization-id') organizationIdHeader?: string,
  ) {
    const orgId = organizationId === 'current' ? organizationIdHeader : organizationId;
    return this.membersService.resendInvitation(user.userId, orgId, invitationId);
  }

  @Delete('organizations/:organizationId/invitations/:invitationId')
  @ApiOperation({ summary: 'Cancel/revoke an invitation' })
  async cancelInvitation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('organizationId') organizationId: string,
    @Param('invitationId') invitationId: string,
    @Headers('x-organization-id') organizationIdHeader?: string,
  ) {
    const orgId = organizationId === 'current' ? organizationIdHeader : organizationId;
    return this.membersService.cancelInvitation(user.userId, orgId, invitationId);
  }

  @Patch('organizations/:organizationId/members/:memberId/role')
  @ApiOperation({ summary: 'Update a member role with Owner Protection rules' })
  async updateRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param('organizationId') organizationId: string,
    @Param('memberId') memberId: string,
    @Body() input: UpdateMemberRoleDto,
    @Headers('x-organization-id') organizationIdHeader?: string,
  ) {
    const orgId = organizationId === 'current' ? organizationIdHeader : organizationId;
    return this.membersService.updateMemberRole(user.userId, orgId, memberId, input.role);
  }

  @Patch('organizations/:organizationId/members/:memberId/status')
  @ApiOperation({ summary: 'Update member status (Lock, Suspend, Unlock)' })
  async updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('organizationId') organizationId: string,
    @Param('memberId') memberId: string,
    @Body() input: UpdateMemberStatusDto,
    @Headers('x-organization-id') organizationIdHeader?: string,
  ) {
    const orgId = organizationId === 'current' ? organizationIdHeader : organizationId;
    return this.membersService.updateMemberStatus(user.userId, orgId, memberId, input.status, input.reason);
  }

  @Delete('organizations/:organizationId/members/:memberId')
  @ApiOperation({ summary: 'Remove a member from the organization' })
  async removeMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('organizationId') organizationId: string,
    @Param('memberId') memberId: string,
    @Headers('x-organization-id') organizationIdHeader?: string,
  ) {
    const orgId = organizationId === 'current' ? organizationIdHeader : organizationId;
    return this.membersService.removeMember(user.userId, orgId, memberId);
  }
}
