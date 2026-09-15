import { Body, Controller, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ConversionJobService } from '../application/conversion-job.service';
import { BulkCreateConversionJobDto, CreateConversionJobDto } from './conversion.dto';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';

@ApiTags('Conversion Jobs')
@ApiBearerAuth()
@ApiHeader({ name: 'x-organization-id', required: false, description: 'Optional organization ID context' })
@UseGuards(JwtAuthGuard)
@Controller()
export class ConversionsController {
  constructor(private readonly conversions: ConversionJobService) {}

  @Post('projects/:projectId/conversions')
  @ApiOperation({ summary: 'Submit single screen conversion job', description: 'Enqueues legacy screen source code for conversion.' })
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

  @Post('projects/:projectId/conversions/bulk')
  @ApiOperation({ summary: 'Submit bulk screen conversion jobs', description: 'Enqueues multiple screens for batch processing.' })
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

  @Get('projects/:projectId/conversions')
  @ApiOperation({ summary: 'List all conversion jobs for a project', description: 'Retrieve history and progress of conversions.' })
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
  @ApiOperation({ summary: 'List conversion jobs for a specific screen', description: 'Filter jobs by screen ID.' })
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
  @ApiOperation({ summary: 'Get conversion job details', description: 'Get status, converted code, and logs by job ID.' })
  @ApiParam({ name: 'id', description: 'Conversion Job ID' })
  @ApiResponse({ status: 200, description: 'Conversion job details' })
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('id') id: string,
  ) {
    return this.conversions.get(user.userId, organizationId, id);
  }

  @Post('conversions/:id/retry')
  @ApiOperation({ summary: 'Retry a failed conversion job', description: 'Re-enqueues failed conversion job.' })
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
