import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { CreateSupportTicketService } from '../application/create-support-ticket.service';
import { GetSupportTicketService } from '../application/get-support-ticket.service';
import { ListSupportTicketsService } from '../application/list-support-tickets.service';
import { TransitionSupportTicketService } from '../application/transition-support-ticket.service';
import { SupportTicketPresenter } from './support-ticket.presenter';
import { SupportTicketOperation, SupportTicketOwnerGuard } from './support-ticket-owner.guard';
import {
  CreateSupportTicketDto,
  EmptySupportTicketQueryDto,
  ListSupportTicketsDto,
  SupportTicketOrganizationParamsDto,
  SupportTicketParamsDto,
  TransitionSupportTicketDto,
  SupportTicketResponseDto,
  SupportTicketPageResponseDto,
} from './support-ticket.dto';

@ApiTags('Support Tickets')
@ApiBearerAuth()
@ApiResponse({
  status: 401,
  description: 'Valid access token and current persisted session required',
})
@ApiResponse({
  status: 403,
  description: 'Verified Organisation Owner authority required; no staff/Admin bypass',
})
@ApiResponse({ status: 400, description: 'Invalid request or unknown fields' })
@ApiResponse({ status: 404, description: 'Ticket unavailable in the authorized Organisation' })
@ApiResponse({ status: 409, description: 'Revision conflict or invalid lifecycle transition' })
@ApiResponse({
  status: 503,
  description:
    'Authority/persistence unavailable or SUPPORT_TICKET_OUTCOME_UNCONFIRMED; reconcile original identity, never auto-retry',
})
@UseGuards(JwtAuthGuard, SupportTicketOwnerGuard)
@Controller('organizations/:organizationId/support-tickets')
export class SupportTicketController {
  constructor(
    private readonly createTicket: CreateSupportTicketService,
    private readonly getTicket: GetSupportTicketService,
    private readonly listTickets: ListSupportTicketsService,
    private readonly transitionTicket: TransitionSupportTicketService,
  ) {}

  @Post()
  @SupportTicketOperation('CREATE')
  @ApiCreatedResponse({ type: SupportTicketResponseDto })
  @ApiOperation({
    summary: 'Owner creates an ordinary Ticket; no consent or Support access is granted',
  })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: SupportTicketOrganizationParamsDto,
    @Body() body: CreateSupportTicketDto,
    @Query() _query: EmptySupportTicketQueryDto,
  ) {
    void _query;
    return SupportTicketPresenter.ticket(
      await this.createTicket.execute({
        actorUserId: user.userId,
        organizationId: params.organizationId,
        purposeId: body.purposeId,
      }),
    );
  }

  @Get()
  @SupportTicketOperation('LIST')
  @ApiOkResponse({ type: SupportTicketPageResponseDto })
  @ApiOperation({ summary: 'Owner lists their Organisation Tickets, ordered by immutable ID' })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: SupportTicketOrganizationParamsDto,
    @Query() query: ListSupportTicketsDto,
  ) {
    return SupportTicketPresenter.page(
      await this.listTickets.execute({
        actorUserId: user.userId,
        organizationId: params.organizationId,
        limit: query.limit,
        afterTicketId: query.afterTicketId,
      }),
    );
  }

  @Get(':ticketId')
  @SupportTicketOperation('READ')
  @ApiOkResponse({ type: SupportTicketResponseDto })
  @ApiOperation({ summary: 'Owner retrieves one Ticket in their Organisation' })
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: SupportTicketParamsDto,
    @Query() _query: EmptySupportTicketQueryDto,
  ) {
    void _query;
    return SupportTicketPresenter.ticket(
      await this.getTicket.execute({
        actorUserId: user.userId,
        organizationId: params.organizationId,
        ticketId: params.ticketId,
      }),
    );
  }

  @Post(':ticketId/close')
  @HttpCode(200)
  @SupportTicketOperation('CLOSE')
  @ApiOkResponse({ type: SupportTicketResponseDto })
  @ApiOperation({ summary: 'Owner closes an OPEN Ticket with an expected revision' })
  async close(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: SupportTicketParamsDto,
    @Body() body: TransitionSupportTicketDto,
    @Query() _query: EmptySupportTicketQueryDto,
  ) {
    void _query;
    return SupportTicketPresenter.ticket(
      await this.transitionTicket.execute({
        actorUserId: user.userId,
        organizationId: params.organizationId,
        ticketId: params.ticketId,
        expectedRevision: body.expectedRevision,
        action: 'CLOSE',
      }),
    );
  }

  @Post(':ticketId/cancel')
  @HttpCode(200)
  @SupportTicketOperation('CANCEL')
  @ApiOkResponse({ type: SupportTicketResponseDto })
  @ApiOperation({ summary: 'Owner cancels an OPEN Ticket with an expected revision' })
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: SupportTicketParamsDto,
    @Body() body: TransitionSupportTicketDto,
    @Query() _query: EmptySupportTicketQueryDto,
  ) {
    void _query;
    return SupportTicketPresenter.ticket(
      await this.transitionTicket.execute({
        actorUserId: user.userId,
        organizationId: params.organizationId,
        ticketId: params.ticketId,
        expectedRevision: body.expectedRevision,
        action: 'CANCEL',
      }),
    );
  }

  @Post(':ticketId/reopen')
  @HttpCode(200)
  @SupportTicketOperation('REOPEN')
  @ApiOkResponse({ type: SupportTicketResponseDto })
  @ApiOperation({
    summary: 'Owner reopens a terminal Ticket with a fresh episode and expected revision',
  })
  async reopen(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: SupportTicketParamsDto,
    @Body() body: TransitionSupportTicketDto,
    @Query() _query: EmptySupportTicketQueryDto,
  ) {
    void _query;
    return SupportTicketPresenter.ticket(
      await this.transitionTicket.execute({
        actorUserId: user.userId,
        organizationId: params.organizationId,
        ticketId: params.ticketId,
        expectedRevision: body.expectedRevision,
        action: 'REOPEN',
      }),
    );
  }
}
