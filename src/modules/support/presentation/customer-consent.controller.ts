import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { instanceToPlain } from 'class-transformer';
import type { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { GetCustomerConsentStatusService } from '../application/get-customer-consent-status.service';
import { RequestCustomerConsentService } from '../application/request-customer-consent.service';
import { TransitionCustomerConsentService } from '../application/transition-customer-consent.service';
import { EmptySupportTicketQueryDto, SupportTicketParamsDto } from './support-ticket.dto';
import { SupportTicketOperation, SupportTicketOwnerGuard } from './support-ticket-owner.guard';
import {
  CustomerConsentParamsDto,
  CustomerConsentResponseDto,
  CustomerConsentStatusQueryDto,
  CustomerConsentStatusResponseDto,
  DeclineCustomerConsentDto,
  RequestCustomerConsentDto,
} from './customer-consent.dto';
import { CustomerConsentPresenter } from './customer-consent.presenter';

/** Isolated E3 contract only. Never registered without reviewed independent authority. */
@ApiTags('Customer Consent (unregistered)')
@ApiBearerAuth()
@ApiResponse({ status: 400, description: 'Invalid input or extra body/query fields' })
@ApiResponse({ status: 401, description: 'Valid JWT, account and current session required' })
@ApiResponse({
  status: 403,
  description: 'Current Owner AND independent Consent action authority required',
})
@ApiResponse({ status: 404, description: 'Resource unavailable in the authorized scope' })
@ApiResponse({ status: 409, description: 'Stale revision, context or unavailable transition' })
@ApiResponse({
  status: 503,
  description:
    'Authority/persistence unavailable or unconfirmed outcome; reconcile original IDs, never auto-retry',
})
@UseGuards(JwtAuthGuard, SupportTicketOwnerGuard)
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
@Controller('organizations/:organizationId/support-tickets/:ticketId/customer-consents')
export class CustomerConsentController {
  constructor(
    private readonly requests: RequestCustomerConsentService,
    private readonly statuses: GetCustomerConsentStatusService,
    private readonly transitions: TransitionCustomerConsentService,
  ) {}

  @Post()
  @SupportTicketOperation('READ')
  @ApiCreatedResponse({ type: CustomerConsentResponseDto })
  @ApiOperation({ summary: 'Request pending Consent; no verified grant or Support access' })
  async request(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: SupportTicketParamsDto,
    @Body() body: RequestCustomerConsentDto,
    @Query() _query: EmptySupportTicketQueryDto,
  ) {
    void _query;
    // Detach DTO instances synchronously; E1 captures and validates before its first await.
    const { episodeId, expectedTicketRevision, proposal, source } = instanceToPlain(
      body,
    ) as RequestCustomerConsentDto;
    return CustomerConsentPresenter.write(
      await this.requests.execute({
        actorUserId: user.userId,
        organizationId: params.organizationId,
        ticketId: params.ticketId,
        episodeId,
        expectedTicketRevision,
        scope: proposal.scope,
        proposal,
        source,
      }),
    );
  }

  @Get(':consentId')
  @SupportTicketOperation('READ')
  @ApiOkResponse({ type: CustomerConsentStatusResponseDto })
  @ApiOperation({ summary: 'Read scoped status with operationalAccess false' })
  async status(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: CustomerConsentParamsDto,
    @Query() query: CustomerConsentStatusQueryDto,
  ) {
    return CustomerConsentPresenter.status(
      await this.statuses.execute({
        actorUserId: user.userId,
        organizationId: params.organizationId,
        ticketId: params.ticketId,
        consentId: params.consentId,
        episodeId: query.episodeId,
        expectedTicketRevision: query.expectedTicketRevision,
        scope: {
          useCase: 'UC66',
          mode: 'READ_ONLY',
          purposeId: query.purposeId,
          operation: query.operation,
          projectionId: query.projectionId,
          environmentId: query.environmentId,
        },
      }),
    );
  }

  @Post(':consentId/decline')
  @HttpCode(200)
  @SupportTicketOperation('READ')
  @ApiOkResponse({ type: CustomerConsentResponseDto })
  @ApiOperation({
    summary: 'Verified original grantor refuses a pending request, while still an Owner',
  })
  async decline(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: CustomerConsentParamsDto,
    @Body() body: DeclineCustomerConsentDto,
    @Query() _query: EmptySupportTicketQueryDto,
  ) {
    void _query;
    const { episodeId, expectedTicketRevision, expectedRevision, scope, source } = instanceToPlain(
      body,
    ) as DeclineCustomerConsentDto;
    return CustomerConsentPresenter.write(
      await this.transitions.execute({
        actorUserId: user.userId,
        organizationId: params.organizationId,
        ticketId: params.ticketId,
        consentId: params.consentId,
        episodeId,
        expectedTicketRevision,
        expectedRevision,
        scope,
        source,
        action: 'DECLINE',
      }),
    );
  }
}
