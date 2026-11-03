import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { CurrentSessionGuard } from '../../../shared/security/current-session.guard';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { AcceptContractInvitationService } from '../application/accept-contract-invitation.service';
import { RegisterProspectService } from '../application/register-prospect.service';
import { ResolveContractInvitationService } from '../application/resolve-contract-invitation.service';
import { InvitationTokenDto, RegisterProspectDto } from './contract-invitations.dto';

@ApiTags('Prospect Contract Invitations')
@Controller('auth/prospects')
export class ProspectInvitationsController {
  constructor(
    private readonly resolveInvitation: ResolveContractInvitationService,
    private readonly registerProspect: RegisterProspectService,
    private readonly acceptInvitation: AcceptContractInvitationService,
  ) {}

  @Post('invitations/resolve')
  @ApiOperation({ summary: 'Resolve an invitation token without creating an account or exposing Lead details' })
  @ApiResponse({ status: 200, description: 'Returns masked recipient and next required action' })
  @ApiResponse({ status: 400, description: 'Invitation is unavailable' })
  async resolve(@Body() dto: InvitationTokenDto, @Req() request: Request) {
    return this.resolveInvitation.execute(dto.invitationToken, request.socket.remoteAddress);
  }

  @Post('register')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Create a prospect account only for a valid invitation; email is derived from the invitation' })
  @ApiResponse({ status: 202, description: 'Generic anti-enumeration result; no session is issued' })
  @ApiResponse({ status: 400, description: 'Invitation is unavailable' })
  async register(@Body() dto: RegisterProspectDto, @Req() request: Request) {
    return this.registerProspect.execute({
      invitationToken: dto.invitationToken,
      fullName: dto.fullName,
      password: dto.password,
      clientAddress: request.socket.remoteAddress,
    });
  }

  @Post('invitations/accept')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, CurrentSessionGuard)
  @ApiOperation({ summary: 'Accept an invitation using the signed-in, verified account matching its invited email' })
  @ApiResponse({ status: 200, description: 'Creates a resource-scoped Lead grant; phone remains unverified' })
  async accept(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: InvitationTokenDto,
    @Req() request: Request,
  ) {
    return this.acceptInvitation.execute({
      userId: user.userId,
      invitationToken: dto.invitationToken,
      clientAddress: request.socket.remoteAddress,
    });
  }
}
