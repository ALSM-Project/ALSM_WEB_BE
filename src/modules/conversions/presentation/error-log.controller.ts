import {
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
  Headers,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { ErrorLogService } from '../application/error-log.service';
import {
  ErrorLogResponseDto,
  ErrorLogSummaryResponseDto,
  ListErrorLogsQueryDto,
} from './error-log.dto';

@ApiTags('Error Logs (UC-17)')
@ApiBearerAuth()
@ApiHeader({ name: 'x-organization-id', required: false, description: 'Organization scope override' })
@UseGuards(JwtAuthGuard)
@Controller('projects/:projectId/error-logs')
export class ErrorLogController {
  constructor(private readonly errorLogService: ErrorLogService) {}

  /**
   * UC-17: List all error logs for a project with optional filters and pagination
   * GET /projects/:projectId/error-logs
   */
  @Get()
  @ApiOperation({
    summary: 'List error logs for a project',
    description: 'Returns a paginated list of error logs for a given project. Supports filtering by severity, status, and search keyword.',
  })
  @ApiResponse({ status: 200, description: 'Paginated list of error logs', type: ErrorLogResponseDto, isArray: true })
  @ApiResponse({ status: 403, description: 'Forbidden – not a member of the organization' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('projectId') projectId: string,
    @Query() query: ListErrorLogsQueryDto,
  ) {
    return this.errorLogService.list(user.userId, organizationId, projectId, query);
  }

  /**
   * UC-17: Get a single error log by ID
   * GET /projects/:projectId/error-logs/:logId
   */
  @Get(':logId')
  @ApiOperation({
    summary: 'Get error log detail by ID',
    description: 'Returns the full detail of an error log including offending code and AI-suggested patch.',
  })
  @ApiResponse({ status: 200, description: 'Error log detail', type: ErrorLogResponseDto })
  @ApiResponse({ status: 404, description: 'Error log not found' })
  async getById(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('projectId') projectId: string,
    @Param('logId') logId: string,
  ) {
    return this.errorLogService.getById(user.userId, organizationId, projectId, logId);
  }

  /**
   * UC-17: Get diagnostic summary counts (fatal/warning/resolved etc.) for a project
   * GET /projects/:projectId/error-logs/summary
   */
  @Get('summary')
  @ApiOperation({
    summary: 'Get error log summary statistics for a project',
    description: 'Returns aggregated counts by severity and resolution status.',
  })
  @ApiResponse({ status: 200, description: 'Error log summary statistics', type: ErrorLogSummaryResponseDto })
  async getSummary(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('projectId') projectId: string,
  ) {
    return this.errorLogService.getSummary(user.userId, organizationId, projectId);
  }

  /**
   * UC-17: Resolve an error log (mark as fixed / AI patch applied)
   * PATCH /projects/:projectId/error-logs/:logId/resolve
   */
  @Patch(':logId/resolve')
  @ApiOperation({
    summary: 'Mark an error log as resolved',
    description: 'Marks the specified error log as RESOLVED and records the resolving user and timestamp.',
  })
  @ApiResponse({ status: 200, description: 'Error log marked as resolved', type: ErrorLogResponseDto })
  @ApiResponse({ status: 404, description: 'Error log not found' })
  async resolve(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('projectId') projectId: string,
    @Param('logId') logId: string,
  ) {
    return this.errorLogService.resolve(user.userId, organizationId, projectId, logId);
  }

  /**
   * UC-17: Ignore an error log
   * PATCH /projects/:projectId/error-logs/:logId/ignore
   */
  @Patch(':logId/ignore')
  @ApiOperation({
    summary: 'Ignore an error log',
    description: 'Marks the specified error log as IGNORED so it no longer appears in the active list.',
  })
  @ApiResponse({ status: 200, description: 'Error log marked as ignored', type: ErrorLogResponseDto })
  @ApiResponse({ status: 404, description: 'Error log not found' })
  async ignore(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('projectId') projectId: string,
    @Param('logId') logId: string,
  ) {
    return this.errorLogService.ignore(user.userId, organizationId, projectId, logId);
  }
}
