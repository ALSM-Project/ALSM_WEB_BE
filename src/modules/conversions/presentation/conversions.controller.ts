import { Body, Controller, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { ConversionJobService } from '../application/conversion-job.service';
import { BulkCreateConversionJobDto, CreateConversionJobDto } from './conversion.dto';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
@ApiTags('Conversion Jobs')
@ApiBearerAuth()
@ApiHeader({ name: 'x-organization-id', required: false })
@UseGuards(JwtAuthGuard)
@Controller()
export class ConversionsController {
  constructor(private readonly conversions: ConversionJobService) {}
  @Post('projects/:projectId/conversions') async create(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('projectId') projectId: string,
    @Body() dto: CreateConversionJobDto,
  ) {
    return this.conversions.create(user.userId, organizationId, projectId, dto);
  }
  @Post('projects/:projectId/conversions/bulk') async createBulk(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('projectId') projectId: string,
    @Body() dto: BulkCreateConversionJobDto,
  ) {
    return this.conversions.createBulk(user.userId, organizationId, projectId, dto);
  }
  @Get('projects/:projectId/conversions') async list(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('projectId') projectId: string,
  ) {
    return this.conversions.list(user.userId, organizationId, projectId);
  }
  @Get('projects/:projectId/screens/:screenId/conversions') async listByScreen(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('projectId') projectId: string,
    @Param('screenId') screenId: string,
  ) {
    return this.conversions.listByScreen(user.userId, organizationId, projectId, screenId);
  }
  @Get('conversions/:id') async get(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('id') id: string,
  ) {
    return this.conversions.get(user.userId, organizationId, id);
  }
  @Post('conversions/:id/retry') async retry(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('id') id: string,
  ) {
    return this.conversions.retry(user.userId, organizationId, id);
  }
}
