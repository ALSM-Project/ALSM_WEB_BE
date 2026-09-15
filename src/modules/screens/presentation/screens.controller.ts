import { Controller, Get, Headers, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { ScreenService } from '../application/screen.service';

@ApiTags('Screens')
@ApiBearerAuth()
@ApiHeader({ name: 'x-organization-id', required: false, description: 'Optional organization ID context' })
@UseGuards(JwtAuthGuard)
@Controller()
export class ScreensController {
  constructor(private readonly screens: ScreenService) {}

  @Get('projects/:projectId/screens')
  @ApiOperation({ summary: 'List real, persisted screens/programs for a project', description: 'Backed by uploads that created a real screen record — not an in-memory or mock list.' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiResponse({ status: 200, description: 'List of screens' })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('projectId') projectId: string,
  ) {
    return this.screens.list(user.userId, organizationId, projectId);
  }

  @Get('screens/:id')
  @ApiOperation({ summary: 'Get a single screen by ID' })
  @ApiParam({ name: 'id', description: 'Screen ID' })
  @ApiResponse({ status: 200, description: 'Screen details' })
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('id') id: string,
  ) {
    return this.screens.getById(user.userId, organizationId, id);
  }
}
