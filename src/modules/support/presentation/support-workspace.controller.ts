import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import {
  ReadSupportWorkspaceService,
  SUPPORT_WORKSPACE_OPERATIONS,
} from '../application/read-support-workspace.service';
import { EmptySupportContextDto, SupportContextParamsDto } from './support-context.dto';
import {
  SupportWorkspaceDetailDto,
  SupportWorkspaceDetailResponseDto,
  SupportWorkspacePageDto,
  SupportWorkspacePageResponseDto,
  SupportWorkspaceProjectDto,
  SupportWorkspaceResourceDto,
} from './support-workspace.dto';

@ApiTags('UC-66 Workspace (unregistered)')
@ApiBearerAuth()
@ApiResponse({
  status: 503,
  description:
    'Audit/storage unavailable or outcome unconfirmed; retain context identity and do not blindly replay',
})
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
@Controller('support/organizations/:organizationId/contexts/:contextId/workspace')
export class SupportWorkspaceController {
  constructor(private readonly reads: ReadSupportWorkspaceService) {}
  @Get('projects')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: SupportWorkspacePageResponseDto })
  @ApiOperation({ summary: 'Bounded read-only Project metadata list' })
  listProjects(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: SupportContextParamsDto,
    @Query() query: SupportWorkspacePageDto,
    @Body() _body: EmptySupportContextDto,
  ) {
    void _body;
    return this.reads.execute(
      user,
      { ...params, ...query, kind: 'projects' },
      SUPPORT_WORKSPACE_OPERATIONS.projects[0],
    );
  }
  @Get('projects/:projectId')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: SupportWorkspaceDetailResponseDto })
  @ApiOperation({ summary: 'Read-only Project diagnostic detail' })
  project(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: SupportWorkspaceProjectDto,
    @Query() _query: EmptySupportContextDto,
    @Body() _body: EmptySupportContextDto,
  ) {
    void _query;
    void _body;
    const { projectId, ...scope } = params;
    return this.reads.execute(
      user,
      { ...scope, id: projectId, kind: 'projects' },
      SUPPORT_WORKSPACE_OPERATIONS.projects[1],
    );
  }
  @Get('projects/:projectId/:resource')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: SupportWorkspacePageResponseDto })
  @ApiOperation({ summary: 'Bounded Screen/Program/Finding/Conversion Log/Error Log diagnostics' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: SupportWorkspaceResourceDto,
    @Query() query: SupportWorkspacePageDto,
    @Body() _body: EmptySupportContextDto,
  ) {
    void _body;
    const { resource, ...scope } = params;
    return this.reads.execute(
      user,
      { ...scope, ...query, kind: resource },
      SUPPORT_WORKSPACE_OPERATIONS[resource][0],
    );
  }
  @Get('projects/:projectId/:resource/:resourceId')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: SupportWorkspaceDetailResponseDto })
  @ApiOperation({ summary: 'Scoped diagnostic detail; no raw source, download or mutation' })
  detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: SupportWorkspaceDetailDto,
    @Query() _query: EmptySupportContextDto,
    @Body() _body: EmptySupportContextDto,
  ) {
    void _query;
    void _body;
    const { resource, resourceId, ...scope } = params;
    return this.reads.execute(
      user,
      { ...scope, id: resourceId, kind: resource },
      SUPPORT_WORKSPACE_OPERATIONS[resource][1],
    );
  }
}
