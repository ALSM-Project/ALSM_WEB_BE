import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { PermissionsGuard } from '../../../shared/security/permissions.guard';
import { RequirePermissions } from '../../../shared/security/require-permissions.decorator';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { OnboardUserService } from '../application/onboard-user.service';
import { UpdateUserStatusService } from '../application/update-user-status.service';
import { RbacService } from '../../rbac/application/rbac.service';
import { OnboardUserDto, UpdateUserStatusDto } from './users.dto';

@ApiTags('Users (UC-82)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('users')
export class UsersController {
  constructor(
    private readonly onboardUserService: OnboardUserService,
    private readonly updateUserStatusService: UpdateUserStatusService,
    private readonly rbacService: RbacService,
  ) {}

  @Get()
  @RequirePermissions('users.manage')
  @ApiOperation({ summary: 'List all users', description: 'Requires users.manage permission.' })
  @ApiResponse({ status: 200, description: 'Users retrieved successfully' })
  async list() {
    return this.rbacService.getAllUsers();
  }

  @Post()
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

  @Patch(':id/status')
  @RequirePermissions('users.manage')
  @ApiOperation({
    summary: 'Activate or deactivate a user',
    description: 'Requires users.manage permission.',
  })
  @ApiResponse({ status: 200, description: 'User status updated' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async updateStatus(@Param('id') id: string, @Body() dto: UpdateUserStatusDto) {
    await this.updateUserStatusService.execute(id, dto.isActive);
    return { ok: true };
  }
}
