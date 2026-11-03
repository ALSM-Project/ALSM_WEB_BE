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
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { AuthorizeSupportContextReadService } from '../application/authorize-support-context-read.service';
import { EnterSupportContextService } from '../application/enter-support-context.service';
import { ExitSupportContextService } from '../application/exit-support-context.service';
import { SearchSupportOrganizationsService } from '../application/search-support-organizations.service';
import {
  EmptySupportContextDto,
  SupportContextParamsDto,
  SupportContextResponseDto,
  SupportOrganizationPageDto,
  SupportOrganizationParamsDto,
  SupportOrganizationSearchDto,
} from './support-context.dto';
import { SupportContextPresenter } from './support-context.presenter';

@ApiTags('UC-66 Support foundation (unregistered)')
@ApiBearerAuth()
@ApiResponse({ status: 401, description: 'Current persisted original account/session required' })
@ApiResponse({
  status: 403,
  description:
    'Persisted INTERNAL_SUPPORT assignment and organizations.impersonate grant required; no Admin expansion',
})
@ApiResponse({ status: 400, description: 'Invalid input or unknown body/query fields' })
@ApiResponse({
  status: 404,
  description: 'Organisation/context unavailable in this exact actor/session/Organisation scope',
})
@ApiResponse({
  status: 409,
  description: 'Existing active context, expired context or concurrent change',
})
@ApiResponse({
  status: 503,
  description:
    'Support state/audit unavailable or SUPPORT_CONTEXT_OUTCOME_UNCONFIRMED; reconcile context identity, never blindly retry',
})
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
@Controller('support/organizations')
export class SupportContextController {
  constructor(
    private readonly search: SearchSupportOrganizationsService,
    private readonly enter: EnterSupportContextService,
    private readonly exit: ExitSupportContextService,
    private readonly reads: AuthorizeSupportContextReadService,
  ) {}

  @Get()
  @ApiOkResponse({ type: SupportOrganizationPageDto })
  @ApiOperation({
    summary:
      'Support searches a bounded customer Organisation directory by name prefix or exact contact email',
  })
  async searchOrganizations(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: SupportOrganizationSearchDto,
  ) {
    return this.search.execute(user, query);
  }

  @Post(':organizationId/contexts')
  @ApiCreatedResponse({ type: SupportContextResponseDto })
  @ApiOperation({
    summary:
      'Create a server-controlled read-only Support context; no customer identity or workspace access',
  })
  async enterOrganization(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: SupportOrganizationParamsDto,
    @Body() _body: EmptySupportContextDto,
    @Query() _query: EmptySupportContextDto,
  ) {
    void _body;
    void _query;
    return SupportContextPresenter.response(await this.enter.execute(user, params.organizationId));
  }

  @Get(':organizationId/contexts/:contextId')
  @ApiOkResponse({ type: SupportContextResponseDto })
  @ApiOperation({
    summary:
      'Inspect own active context; authorized activity and its audit refresh idle time transactionally',
  })
  async contextStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: SupportContextParamsDto,
    @Query() _query: EmptySupportContextDto,
  ) {
    void _query;
    return SupportContextPresenter.response(
      await this.reads.execute(user, params.organizationId, params.contextId, 'CONTEXT_STATUS'),
    );
  }

  @Post(':organizationId/contexts/:contextId/exit')
  @ApiOkResponse({ type: SupportContextResponseDto })
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Terminate the exact original-session context; repeated exits are idempotent without duplicate EXIT audit',
  })
  async exitOrganization(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: SupportContextParamsDto,
    @Body() _body: EmptySupportContextDto,
    @Query() _query: EmptySupportContextDto,
  ) {
    void _body;
    void _query;
    return SupportContextPresenter.response(
      await this.exit.execute(user, params.organizationId, params.contextId),
    );
  }
}
