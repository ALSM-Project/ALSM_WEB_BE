import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ProjectService } from '../application/project.service';
import { CreateProjectDto, UpdateProjectDto } from './project.dto';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';

@ApiTags('Projects')
@ApiBearerAuth()
@ApiHeader({
  name: 'x-organization-id',
  required: false,
  description: 'Optional organization context; defaults to the caller’s first membership.',
})
@UseGuards(JwtAuthGuard)
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a new modernization project',
    description: 'Create a new project within the active organization scope.',
  })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'Project created successfully' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid project payload' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Missing or invalid authentication token' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Body() dto: CreateProjectDto,
  ) {
    return this.projects.create(user.userId, organizationId, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List projects',
    description: 'Retrieve all modernization projects for the authenticated user and organization.',
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'List of projects retrieved successfully' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Missing or invalid authentication token' })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
  ) {
    return this.projects.list(user.userId, organizationId);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get project details by ID',
    description: 'Retrieve detailed configuration and statistics for a specific project.',
  })
  @ApiParam({ name: 'id', description: 'Unique Project ID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Project details retrieved successfully' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Project not found' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Missing or invalid authentication token' })
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('id') id: string,
  ) {
    return this.projects.get(user.userId, organizationId, id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update project settings',
    description: 'Update project name, description, or target framework configuration.',
  })
  @ApiParam({ name: 'id', description: 'Unique Project ID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Project updated successfully' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Project not found' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Missing or invalid authentication token' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projects.update(user.userId, organizationId, id, dto);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id')
  @ApiOperation({
    summary: 'Delete project',
    description: 'Permanently remove a project and its associated screen conversions.',
  })
  @ApiParam({ name: 'id', description: 'Unique Project ID' })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'Project deleted successfully' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Project not found' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Missing or invalid authentication token' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('id') id: string,
  ): Promise<void> {
    await this.projects.remove(user.userId, organizationId, id);
  }
}
