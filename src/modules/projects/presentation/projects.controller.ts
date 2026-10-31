import {
  BadRequestException,
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
  Query,
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
import { ProjectStaffAllocationService } from '../application/project-staff-allocation.service';
import { PermissionsGuard } from '../../../shared/security/permissions.guard';
import {
  AllocateStaffBatchDto,
  AdminReviewProjectDto,
  AssignProjectStaffDto,
  AssignTeamLeadDto,
  CreateProjectDto,
  CustomerAcceptanceDto,
  RemoveProjectStaffDto,
  UpdateProjectDto,
  UpdateProjectStageDto,
} from './project.dto';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { RequirePermissions } from '../../../shared/security/require-permissions.decorator';
import { PlatformAdminAuthorizationGuard } from '../../admin/presentation/platform-admin-authorization.guard';

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
  constructor(
    private readonly projects: ProjectService,
    private readonly staffAllocation: ProjectStaffAllocationService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Create a new modernization project',
    description: 'Create a new project within the active organization scope.',
  })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'Project created successfully' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid project payload' })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid authentication token',
  })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Body() dto: CreateProjectDto,
  ) {
    return this.projects.create(user.userId, organizationId, dto);
  }

  @Post('demo')
  @ApiOperation({
    summary: 'Create a pre-configured demo project',
    description: 'Creates a demo modernization project for customer presentations (UC-3.10.3).',
  })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'Demo project created' })
  async createDemo(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Body() dto: { name?: string; description?: string },
  ) {
    return this.projects.createDemo(user.userId, organizationId, dto);
  }

  @Get('assignable-staff')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('teams.manage')
  @ApiOperation({
    summary: 'List Conversion Staff a project can be allocated to',
    description:
      'Active Conversion Staff accounts with the number of projects each carries (UC-86). Requires teams.manage.',
  })
  assignableStaff() {
    return this.staffAllocation.listAssignableStaff();
  }

  @Get('assignable-team-leads')
  @UseGuards(PlatformAdminAuthorizationGuard)
  @RequirePermissions('organizations.manage', 'resources.transfer', 'resources.transfer.confirm')
  @ApiOperation({
    summary: 'List internal ALSM Team Leads eligible for project assignment',
    description: 'Only internal ALSM employees with active status are returned.',
  })
  async assignableTeamLeads() {
    return this.projects.listAssignableTeamLeads();
  }

  @Get(':id/assigned-members')
  @ApiOperation({
    summary: 'List staff and members assigned tasks for a project',
    description:
      'Returns the staff member(s) allocated to this project to receive project notifications and meeting invites.',
  })
  @ApiParam({ name: 'id', description: 'Unique Project ID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'List of assigned project members retrieved successfully' })
  async assignedMembers(@Param('id') id: string) {
    return this.staffAllocation.getAssignedMembers(id);
  }

  @Post(':id/assign-staff')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('teams.manage')
  @ApiOperation({
    summary: 'Allocate a project to a Conversion Staff member',
    description:
      'Stores the allocation on the project so it appears in that person work queue, replaces any previous owner, and audits PROJECT_STAFF_ALLOCATED. Requires teams.manage (UC-86).',
  })
  async assignStaff(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AssignProjectStaffDto,
  ) {
    return this.staffAllocation.assign(user.userId, id, dto.staffId, dto.note, dto.reason);
  }

  @Get(':id/allocation')
  @ApiOperation({
    summary: 'Get full project staff allocation overview',
    description: 'Retrieves current assigned staff, team lead, project scale, and capacity metrics.',
  })
  @ApiParam({ name: 'id', description: 'Unique Project ID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Allocation overview retrieved successfully' })
  async getProjectAllocation(@Param('id') id: string) {
    return this.staffAllocation.getProjectAllocation(id);
  }

  @Get(':id/eligible-staff')
  @ApiOperation({
    summary: 'List eligible conversion staff with skills and capacity for this project',
  })
  @ApiParam({ name: 'id', description: 'Unique Project ID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Eligible staff list retrieved successfully' })
  async getEligibleStaff(@Param('id') id: string) {
    return this.staffAllocation.getEligibleStaff(id);
  }

  @Post(':id/allocations')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('teams.manage')
  @ApiOperation({
    summary: 'Allocate staff to project (single or multiple)',
  })
  @ApiParam({ name: 'id', description: 'Unique Project ID' })
  async allocateStaffBatch(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AllocateStaffBatchDto,
  ) {
    const staffIds = Array.isArray(dto.staffIds) && dto.staffIds.length > 0 ? dto.staffIds : [];
    if (staffIds.length === 0) {
      throw new BadRequestException('At least one staff member must be selected');
    }
    const primaryStaffId = staffIds[0];
    const updated = await this.staffAllocation.assign(
      user.userId,
      id,
      primaryStaffId,
      dto.note,
      dto.role || 'Lead Conversion Engineer',
    );
    return updated;
  }

  @Delete(':id/allocations/:staffId')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('teams.manage')
  @ApiOperation({
    summary: 'Remove staff allocation from project',
  })
  @ApiParam({ name: 'id', description: 'Unique Project ID' })
  @ApiParam({ name: 'staffId', description: 'Staff User ID to deallocate' })
  async removeAllocation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('staffId') staffId: string,
    @Query('reason') queryReason?: string,
    @Body() body?: RemoveProjectStaffDto,
  ) {
    const reason = body?.reason || queryReason;
    return this.staffAllocation.removeAllocation(user.userId, id, staffId, reason);
  }

  @Get(':id/allocation-history')
  @ApiOperation({
    summary: 'Get allocation and assignment audit history for a project',
  })
  @ApiParam({ name: 'id', description: 'Unique Project ID' })
  async getAllocationHistory(@Param('id') id: string) {
    return this.staffAllocation.getAllocationHistory(id);
  }

  @Post(':id/assign-team-lead')
  @UseGuards(PlatformAdminAuthorizationGuard)
  @RequirePermissions('organizations.manage', 'resources.transfer', 'resources.transfer.confirm')
  @ApiOperation({
    summary: 'Assign project to a Team Lead',
    description: 'Global assignment requires persisted Platform Admin status, organizations.manage and both resource transfer execution permissions (UC-3.13.3).',
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Project assigned to Team Lead' })
  async assignTeamLead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AssignTeamLeadDto,
  ) {
    return this.projects.assignTeamLead(user.userId, id, dto.teamLeadId, dto.note);
  }

  @Post(':id/admin-review')
  @UseGuards(PlatformAdminAuthorizationGuard)
  @ApiOperation({
    summary: 'Admin review customer submission (Approve, Request Info, Reject)',
  })
  async adminReview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AdminReviewProjectDto,
  ) {
    return this.projects.adminReview(user.userId, id, dto.action, dto.notes);
  }

  @Patch(':id/stage')
  @ApiOperation({
    summary: 'Advance project along the canonical 9 stages',
  })
  async updateStage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateProjectStageDto,
  ) {
    return this.projects.updateStage(user.userId, id, dto.stage, dto.note);
  }

  @Post(':id/acceptance')
  @ApiOperation({
    summary: 'Customer signs off and accepts final deliverables',
  })
  async acceptDeliverables(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('id') id: string,
    @Body() dto: CustomerAcceptanceDto,
  ) {
    return this.projects.acceptProject(user.userId, organizationId, id, dto.notes);
  }

  @Get()
  @ApiOperation({
    summary: 'List projects',
    description:
      'Retrieve the modernization projects of the organization of the authenticated user. A Platform Admin who does not name an organization gets the projects of every organization.',
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'List of projects retrieved successfully' })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid authentication token',
  })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
  ) {
    return this.projects.list(user.userId, organizationId, user.isPlatformAdmin);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get project details by ID',
    description: 'Retrieve detailed configuration and statistics for a specific project.',
  })
  @ApiParam({ name: 'id', description: 'Unique Project ID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Project details retrieved successfully' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Project not found' })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid authentication token',
  })
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
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid authentication token',
  })
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
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid authentication token',
  })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('id') id: string,
  ): Promise<void> {
    await this.projects.remove(user.userId, organizationId, id);
  }
}
