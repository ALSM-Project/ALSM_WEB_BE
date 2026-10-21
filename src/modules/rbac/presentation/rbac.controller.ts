import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RbacService } from '../application/rbac.service';
import {
  CreatePermissionDto,
  CreateRoleDto,
  UpdatePermissionDto,
  UpdateRoleDto,
  UpdateRolePermissionsDto,
  UpdateUserRolesDto,
} from './rbac.dto';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { PermissionsGuard } from '../../../shared/security/permissions.guard';
import { RequirePermissions } from '../../../shared/security/require-permissions.decorator';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';

@ApiTags('RBAC & Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller(['', 'admin'])
export class RbacController {
  constructor(private readonly rbacService: RbacService) {}

  @Get('roles')
  @RequirePermissions('roles.view')
  @ApiOperation({ summary: 'List system roles', description: 'Requires roles.view permission.' })
  @ApiResponse({ status: 200, description: 'Roles retrieved successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - Missing roles.view permission' })
  async getRoles() {
    return this.rbacService.getRoles();
  }

  @Get('roles/:id')
  @RequirePermissions('roles.view')
  @ApiOperation({
    summary: 'Get role details by ID',
    description: 'Requires roles.view permission.',
  })
  @ApiParam({ name: 'id', description: 'Role ID' })
  @ApiResponse({ status: 200, description: 'Role retrieved successfully' })
  async getRoleById(@Param('id') id: string) {
    return this.rbacService.getRoleById(id);
  }

  @Post('roles')
  @RequirePermissions('roles.manage')
  @ApiOperation({
    summary: 'Create a custom role',
    description: 'Requires roles.manage permission.',
  })
  @ApiResponse({ status: 201, description: 'Role created successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - Missing roles.manage permission' })
  async createRole(@Body() dto: CreateRoleDto, @CurrentUser() user: AuthenticatedUser) {
    const key = dto.key || dto.id;
    return this.rbacService.createRole(key!, dto.name, dto.description, false, user.userId);
  }

  @Patch('roles/:id')
  @RequirePermissions('roles.manage')
  @ApiOperation({
    summary: 'Update role details',
    description: 'Requires roles.manage permission.',
  })
  @ApiParam({ name: 'id', description: 'Role ID' })
  @ApiResponse({ status: 200, description: 'Role updated successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - Missing roles.manage permission' })
  async updateRole(
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.rbacService.updateRole(id, dto.name, dto.description, user.userId);
  }

  @Delete('roles/:id')
  @RequirePermissions('roles.manage')
  @ApiOperation({
    summary: 'Delete a role',
    description: 'Requires roles.manage permission.',
  })
  @ApiParam({ name: 'id', description: 'Role ID' })
  @ApiResponse({ status: 200, description: 'Role deleted successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - Missing roles.manage permission' })
  async deleteRole(
    @Param('id') id: string,
    @Query('force') force: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const forceDelete = force !== 'false';
    await this.rbacService.deleteRole(id, user.userId, forceDelete);
    return { success: true };
  }

  @Get('permissions')
  @RequirePermissions('roles.view')
  @ApiOperation({
    summary: 'List all available system permissions',
    description: 'Requires roles.view or permissions.view permission.',
  })
  @ApiResponse({ status: 200, description: 'Permissions list retrieved successfully' })
  async getPermissions() {
    return this.rbacService.getPermissions();
  }

  @Post('permissions')
  @RequirePermissions('roles.manage')
  @ApiOperation({
    summary: 'Create a new system permission',
    description: 'Requires roles.manage permission.',
  })
  @ApiResponse({ status: 201, description: 'Permission created successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - Missing roles.manage permission' })
  async createPermission(@Body() dto: CreatePermissionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.rbacService.createPermission(
      dto.key,
      dto.label,
      dto.group,
      dto.description,
      user.userId,
    );
  }

  @Patch('permissions/:key')
  @RequirePermissions('roles.manage')
  @ApiOperation({
    summary: 'Update system permission details',
    description: 'Requires roles.manage permission.',
  })
  @ApiParam({ name: 'key', description: 'Permission Key' })
  @ApiResponse({ status: 200, description: 'Permission updated successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - Missing roles.manage permission' })
  async updatePermission(
    @Param('key') key: string,
    @Body() dto: UpdatePermissionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.rbacService.updatePermission(
      key,
      dto.label,
      dto.group,
      dto.description,
      user.userId,
    );
  }

  @Delete('permissions/:key')
  @RequirePermissions('roles.manage')
  @ApiOperation({
    summary: 'Delete a system permission',
    description: 'Requires roles.manage permission.',
  })
  @ApiParam({ name: 'key', description: 'Permission Key' })
  @ApiResponse({ status: 200, description: 'Permission deleted successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - Missing roles.manage permission' })
  async deletePermission(@Param('key') key: string, @CurrentUser() user: AuthenticatedUser) {
    await this.rbacService.deletePermission(key, user.userId);
    return { success: true };
  }

  @Get('roles/:id/permissions')
  @RequirePermissions('roles.view')
  @ApiOperation({
    summary: 'Get permissions assigned to a specific role',
    description: 'Requires roles.view permission.',
  })
  @ApiParam({ name: 'id', description: 'Role ID' })
  @ApiResponse({ status: 200, description: 'Role permissions retrieved successfully' })
  async getRolePermissions(@Param('id') roleId: string) {
    return this.rbacService.getRolePermissions(roleId);
  }

  @Put('roles/:id/permissions')
  @RequirePermissions('roles.manage')
  @ApiOperation({
    summary: 'Update permissions for a role',
    description: 'Requires roles.manage permission.',
  })
  @ApiParam({ name: 'id', description: 'Role ID' })
  @ApiResponse({ status: 200, description: 'Role permissions updated successfully' })
  async updateRolePermissions(
    @Param('id') roleId: string,
    @Body() dto: UpdateRolePermissionsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.rbacService.updateRolePermissions(roleId, dto.permissions, user.userId);
  }

  @Get('users')
  @RequirePermissions('users.view')
  @ApiOperation({
    summary: 'List all registered users',
    description: 'Requires users.view permission.',
  })
  @ApiResponse({ status: 200, description: 'Users list retrieved successfully' })
  async getAllUsers() {
    return this.rbacService.getAllUsers();
  }

  @Get('users/:id/roles')
  @RequirePermissions('users.view')
  @ApiOperation({
    summary: 'Get roles assigned to a user',
    description: 'Requires users.view permission.',
  })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({ status: 200, description: 'User roles retrieved successfully' })
  async getUserRoles(@Param('id') userId: string) {
    return this.rbacService.getUserRoles(userId);
  }

  @Put('users/:id/roles')
  @RequirePermissions('users.manage')
  @ApiOperation({
    summary: 'Assign roles to a user',
    description: 'Requires users.manage permission.',
  })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({ status: 200, description: 'User roles assigned successfully' })
  async updateUserRoles(
    @Param('id') userId: string,
    @Body() dto: UpdateUserRolesDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.rbacService.updateUserRoles(userId, dto.roles, user.userId);
  }
}
