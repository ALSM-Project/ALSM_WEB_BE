import { Body, Controller, Delete, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RbacService } from '../application/rbac.service';
import { CreateRoleDto, UpdateRoleDto, UpdateRolePermissionsDto, UpdateUserRolesDto } from './rbac.dto';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { PermissionsGuard } from '../../../shared/security/permissions.guard';
import { RequirePermissions } from '../../../shared/security/require-permissions.decorator';

@ApiTags('RBAC')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller()
export class RbacController {
  constructor(private readonly rbacService: RbacService) {}

  @Get('roles')
  @RequirePermissions('roles.view')
  async getRoles() {
    return this.rbacService.getRoles();
  }

  @Post('roles')
  @RequirePermissions('roles.manage')
  async createRole(@Body() dto: CreateRoleDto) {
    return this.rbacService.createRole(dto.id, dto.name, dto.description);
  }

  @Patch('roles/:id')
  @RequirePermissions('roles.manage')
  async updateRole(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.rbacService.updateRole(id, dto.name, dto.description);
  }

  @Delete('roles/:id')
  @RequirePermissions('roles.manage')
  async deleteRole(@Param('id') id: string) {
    await this.rbacService.deleteRole(id);
    return { success: true };
  }

  @Get('permissions')
  @RequirePermissions('roles.view')
  async getPermissions() {
    return this.rbacService.getPermissions();
  }

  @Get('roles/:id/permissions')
  @RequirePermissions('roles.view')
  async getRolePermissions(@Param('id') roleId: string) {
    return this.rbacService.getRolePermissions(roleId);
  }

  @Put('roles/:id/permissions')
  @RequirePermissions('roles.manage')
  async updateRolePermissions(
    @Param('id') roleId: string,
    @Body() dto: UpdateRolePermissionsDto,
  ) {
    return this.rbacService.updateRolePermissions(roleId, dto.permissions);
  }

  @Get('users')
  @RequirePermissions('users.view')
  async getAllUsers() {
    return this.rbacService.getAllUsers();
  }

  @Get('users/:id/roles')
  @RequirePermissions('users.view')
  async getUserRoles(@Param('id') userId: string) {
    return this.rbacService.getUserRoles(userId);
  }

  @Put('users/:id/roles')
  @RequirePermissions('users.manage')
  async updateUserRoles(@Param('id') userId: string, @Body() dto: UpdateUserRolesDto) {
    return this.rbacService.updateUserRoles(userId, dto.roles);
  }
}
