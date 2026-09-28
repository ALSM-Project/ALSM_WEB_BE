import { Body, Controller, Get, Headers, Param, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { GetMethodMappingService } from '../application/get-method-mapping.service';
import { SaveMethodMappingService } from '../application/save-method-mapping.service';
import { SaveMethodMappingDto } from './method-mapping.dto';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';

@ApiTags('Method Mapping')
@ApiBearerAuth()
@ApiHeader({ name: 'x-organization-id', required: false, description: 'Optional organization ID context' })
@UseGuards(JwtAuthGuard)
@Controller()
export class MethodMappingController {
  constructor(
    private readonly getMethodMapping: GetMethodMappingService,
    private readonly saveMethodMapping: SaveMethodMappingService,
  ) {}

  @Get('projects/:projectId/screens/:screenId/method-mapping')
  @ApiOperation({
    summary: 'Get COBOL→Java method mapping (UC-28)',
    description: 'Real class/method names detected in the screen\'s latest generated Java code, plus any saved user overrides.',
  })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'screenId', description: 'Screen ID' })
  @ApiResponse({ status: 200, description: 'Method mapping retrieved successfully' })
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('projectId') projectId: string,
    @Param('screenId') screenId: string,
  ) {
    return this.getMethodMapping.execute({
      userId: user.userId,
      organizationHeader: organizationId,
      projectId,
      screenId,
    });
  }

  @Put('projects/:projectId/screens/:screenId/method-mapping')
  @ApiOperation({
    summary: 'Save COBOL→Java method mapping overrides (UC-28)',
    description: 'Persists the user\'s class/method renames and applies them to the screen\'s latest generated Java code.',
  })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'screenId', description: 'Screen ID' })
  @ApiResponse({ status: 200, description: 'Method mapping saved successfully' })
  async save(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('projectId') projectId: string,
    @Param('screenId') screenId: string,
    @Body() dto: SaveMethodMappingDto,
  ) {
    return this.saveMethodMapping.execute({
      userId: user.userId,
      organizationHeader: organizationId,
      projectId,
      screenId,
      entries: dto.entries,
    });
  }
}
