import { Body, Controller, Get, Optional, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { PermissionsGuard } from '../../../shared/security/permissions.guard';
import { RequirePermissions } from '../../../shared/security/require-permissions.decorator';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { OnboardUserService } from '../application/onboard-user.service';
import { UpdateUserStatusService } from '../application/update-user-status.service';
import { UserOffboardingService } from '../application/user-offboarding.service';
import { RbacService } from '../../rbac/application/rbac.service';
import { OnboardUserDto, UpdateUserStatusDto } from './users.dto';
import { ExecuteUserOffboardingDto } from './user-offboarding.dto';
import { PlatformAdminAuthorizationGuard } from '../../admin/presentation/platform-admin-authorization.guard';

@ApiTags('Users (UC-82 / UC-83)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(
    private readonly onboardUserService: OnboardUserService,
    private readonly updateUserStatusService: UpdateUserStatusService,
    private readonly rbacService: RbacService,
    @Optional() private readonly offboardingService?: UserOffboardingService,
  ) {}

  @Get()
  @UseGuards(PermissionsGuard)
  @RequirePermissions('users.manage')
  @ApiOperation({ summary: 'List all users', description: 'Requires users.manage permission.' })
  @ApiResponse({ status: 200, description: 'Users retrieved successfully' })
  async list() {
    return this.rbacService.getAllUsers();
  }

  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermissions('users.onboard')
  @ApiOperation({
    summary: 'Onboard an internal staff account',
    description: 'Requires users.onboard permission.',
  })
  @ApiResponse({ status: 201, description: 'Staff account created' })
  @ApiResponse({ status: 409, description: 'Email already registered' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  async onboard(@CurrentUser() user: AuthenticatedUser, @Body() dto: OnboardUserDto) {
    return this.onboardUserService.execute({
      email: dto.email,
      fullName: dto.fullName,
      role: dto.role,
      organizationId: dto.organizationId,
      actorUserId: user.userId,
    });
  }

  @Get(':id/offboarding-summary')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('users.offboard.review')
  @ApiOperation({
    summary: 'Get user offboarding resource review summary (UC-83)',
    description: 'Retrieves authoritative active sessions, assigned projects, and candidate successors.',
  })
  @ApiResponse({ status: 200, description: 'Offboarding summary retrieved successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async getOffboardingSummary(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.offboardingService?.getOffboardingSummary(
      user.userId,
      id,
      user.isPlatformAdmin,
    );
  }

  @Post(':id/offboard')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('users.offboard')
  @ApiOperation({
    summary: 'Execute user offboarding workflow (UC-83)',
    description: 'Transfers projects, invalidates sessions, revokes roles, and deactivates account.',
  })
  @ApiResponse({ status: 200, description: 'User offboarded successfully' })
  @ApiResponse({ status: 400, description: 'Invalid transfer target or unassigned resources' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async executeOffboard(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ExecuteUserOffboardingDto,
  ) {
    return this.offboardingService?.executeOffboarding(
      user.userId,
      id,
      user.isPlatformAdmin,
      dto,
    );
  }

  @Patch(':id/status')
  @UseGuards(PlatformAdminAuthorizationGuard)
  @RequirePermissions('users.manage')
  @ApiOperation({
    summary: 'Activate or deactivate a user',
    description: 'Global account status changes require persisted Platform Admin status and users.manage.',
  })
  @ApiResponse({ status: 200, description: 'User status updated' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async updateStatus(@Param('id') id: string, @Body() dto: UpdateUserStatusDto) {
    await this.updateUserStatusService.execute(id, dto.isActive);
    return { ok: true };
  }
}
