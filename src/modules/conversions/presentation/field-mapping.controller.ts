import { Body, Controller, Get, Headers, Param, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { GetFieldMappingService } from '../application/get-field-mapping.service';
import { SaveFieldMappingService } from '../application/save-field-mapping.service';
import { SaveFieldMappingDto } from './field-mapping.dto';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';

@ApiTags('Field Mapping')
@ApiBearerAuth()
@ApiHeader({ name: 'x-organization-id', required: false, description: 'Optional organization ID context' })
@UseGuards(JwtAuthGuard)
@Controller()
export class FieldMappingController {
  constructor(
    private readonly getFieldMapping: GetFieldMappingService,
    private readonly saveFieldMapping: SaveFieldMappingService,
  ) {}

  @Get('projects/:projectId/screens/:screenId/field-mapping')
  @ApiOperation({ summary: 'Get field mapping rules', description: 'Retrieve field mappings between legacy DB fields and modernized schema.' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'screenId', description: 'Screen ID' })
  @ApiResponse({ status: 200, description: 'Field mappings retrieved successfully' })
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('projectId') projectId: string,
    @Param('screenId') screenId: string,
  ) {
    return this.getFieldMapping.execute({
      userId: user.userId,
      organizationHeader: organizationId,
      projectId,
      screenId,
    });
  }

  @Put('projects/:projectId/screens/:screenId/field-mapping')
  @ApiOperation({ summary: 'Save field mapping rules', description: 'Save updated field mapping definitions.' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'screenId', description: 'Screen ID' })
  @ApiResponse({ status: 200, description: 'Field mappings saved successfully' })
  async save(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('projectId') projectId: string,
    @Param('screenId') screenId: string,
    @Body() dto: SaveFieldMappingDto,
  ) {
    return this.saveFieldMapping.execute({
      userId: user.userId,
      organizationHeader: organizationId,
      projectId,
      screenId,
      mappings: dto.mappings,
    });
  }
}
