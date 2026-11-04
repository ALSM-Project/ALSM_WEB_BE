import { Body, Controller, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ConversionJobService } from '../application/conversion-job.service';
import { GetConversionResultService } from '../application/get-conversion-result.service';
import {
  BulkCreateConversionJobDto,
  CreateConversionJobDto,
  StartPartnerBulkConversionDto,
  StartPartnerConversionDto,
} from './conversion.dto';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { PermissionsGuard } from '../../../shared/security/permissions.guard';
import { RequirePermissions } from '../../../shared/security/require-permissions.decorator';

@ApiTags('Conversion Jobs')
@ApiBearerAuth()
@ApiHeader({
  name: 'x-organization-id',
  required: false,
  description: 'Optional organization ID context',
})
@UseGuards(JwtAuthGuard)
@Controller()
export class ConversionsController {
  constructor(
    private readonly conversions: ConversionJobService,
    private readonly getResult: GetConversionResultService,
  ) {}

  @Post('projects/:projectId/conversions')
  @ApiOperation({
    summary: 'Submit single screen conversion job',
    description: 'Enqueues legacy screen source code for conversion.',
  })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiResponse({ status: 201, description: 'Conversion job created' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('projectId') projectId: string,
    @Body() dto: CreateConversionJobDto,
  ) {
    return this.conversions.create(user.userId, organizationId, projectId, dto);
  }

  @Post('projects/:projectId/conversions/jobs')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('partner_project.start_conversion')
  @ApiOperation({
    summary: 'Convert or retry one screen/program on behalf of a partner (UC-47)',
    description:
      'Queues a conversion job for the screen. Rejects a screen outside the project (404), one that already has a conversion in progress (409) and a COBOL program blocked by missing copybooks (422).',
  })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiResponse({ status: 201, description: 'Conversion job queued' })
  @ApiResponse({ status: 400, description: 'Queue unavailable (CONVERSION_QUEUE_UNAVAILABLE)' })
  @ApiResponse({ status: 404, description: 'SCREEN_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'CONVERSION_ALREADY_IN_PROGRESS' })
  @ApiResponse({ status: 422, description: 'COPYBOOK_DEPENDENCY_BLOCKED' })
  async startForPartner(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('projectId') projectId: string,
    @Body() dto: StartPartnerConversionDto,
  ) {
    return this.conversions.startForPartner(user.userId, organizationId, projectId, dto);
  }

  @Post('projects/:projectId/conversions/jobs/bulk')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('partner_project.start_conversion')
  @ApiOperation({
    summary: 'Run all conversions for a partner project (UC-47)',
    description:
      'Queues one job per eligible screen and returns the screens that were skipped, with the reason.',
  })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiResponse({ status: 201, description: '{ jobs, skipped }' })
  async startBulkForPartner(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('projectId') projectId: string,
    @Body() dto: StartPartnerBulkConversionDto,
  ) {
    return this.conversions.startBulkForPartner(user.userId, organizationId, projectId, dto);
  }

  @Post('projects/:projectId/conversions/bulk')
  @ApiOperation({
    summary: 'Submit bulk screen conversion jobs',
    description: 'Enqueues multiple screens for batch processing.',
  })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiResponse({ status: 201, description: 'Bulk conversion jobs queued' })
  async createBulk(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('projectId') projectId: string,
    @Body() dto: BulkCreateConversionJobDto,
  ) {
    return this.conversions.createBulk(user.userId, organizationId, projectId, dto);
  }

  @Get('conversion-queue/projects')
  @ApiOperation({
    summary: 'List projects authorized for the conversion queue; staff require explicit assignment',
  })
  async listQueueProjects(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
  ) {
    return this.conversions.listQueueProjects(user.userId, organizationId);
  }

  @Get('projects/:projectId/conversions')
  @ApiOperation({
    summary: 'List all conversion jobs for a project',
    description: 'Retrieve history and progress of conversions.',
  })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiResponse({ status: 200, description: 'List of conversion jobs' })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('projectId') projectId: string,
  ) {
    return this.conversions.list(user.userId, organizationId, projectId);
  }

  @Get('projects/:projectId/screens/:screenId/conversions')
  @ApiOperation({
    summary: 'List conversion jobs for a specific screen',
    description: 'Filter jobs by screen ID.',
  })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'screenId', description: 'Screen ID' })
  @ApiResponse({ status: 200, description: 'List of screen conversion jobs' })
  async listByScreen(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('projectId') projectId: string,
    @Param('screenId') screenId: string,
  ) {
    return this.conversions.listByScreen(user.userId, organizationId, projectId, screenId);
  }

  @Get('conversions/:id')
  @ApiOperation({
    summary: 'Get conversion job details',
    description: 'Get status, converted code, and logs by job ID.',
  })
  @ApiParam({ name: 'id', description: 'Conversion Job ID' })
  @ApiResponse({ status: 200, description: 'Conversion job details' })
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('id') id: string,
  ) {
    return this.conversions.get(user.userId, organizationId, id);
  }

  @Get('conversions/:id/result')
  @ApiOperation({
    summary: 'Get generated code for a completed conversion job',
    description: 'Returns the real files produced by the external conversion tool.',
  })
  @ApiParam({ name: 'id', description: 'Conversion Job ID' })
  @ApiResponse({ status: 200, description: 'Conversion result files' })
  @ApiResponse({ status: 503, description: 'Generated result files unavailable' })
  async getResultFiles(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('id') id: string,
  ) {
    return this.getResult.execute(user.userId, organizationId, id);
  }

  @Post('conversions/:id/retry')
  @ApiOperation({
    summary: 'Retry a failed conversion job',
    description: 'Re-enqueues failed conversion job.',
  })
  @ApiParam({ name: 'id', description: 'Conversion Job ID' })
  @ApiResponse({ status: 200, description: 'Conversion job re-queued' })
  async retry(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('id') id: string,
  ) {
    return this.conversions.retry(user.userId, organizationId, id);
  }
}
