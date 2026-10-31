import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { PermissionsGuard } from '../../../shared/security/permissions.guard';
import { RequirePermissions } from '../../../shared/security/require-permissions.decorator';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { TemporaryRoleService } from '../application/temporary-role.service';
import {
  GrantTemporaryRoleDto,
  RequestTemporaryRoleDto,
  ReviewTemporaryRoleRequestDto,
  RevokeTemporaryRoleDto,
  EligibleStaffQueryDto,
} from './dtos/temporary-role.dto';

@ApiTags('Temporary Role Management (Section 3.15)')
@ApiBearerAuth()
// Every route needs its own permission: without it any signed-in user could raise their own role.
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('rbac/temporary-roles')
export class TemporaryRoleController {
  constructor(private readonly tempRoleService: TemporaryRoleService) {}

  @Get('eligible-staff')
  @RequirePermissions('roles.temporary.grant')
  @ApiOperation({ summary: 'Discover and filter internal staff eligible for temporary elevation' })
  async getEligibleStaff(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: EligibleStaffQueryDto,
  ) {
    return this.tempRoleService.getEligibleStaff(user.userId, query);
  }

  @Get('staff/:staffId/elevation-profile')
  @RequirePermissions('roles.temporary.grant')
  @ApiOperation({ summary: 'Get detailed staff elevation profile and eligibility assessment' })
  async getStaffElevationProfile(
    @Param('staffId') staffId: string,
  ) {
    return this.tempRoleService.getStaffElevationProfile(staffId);
  }

  @Get('elevation-catalog')
  @RequirePermissions('roles.temporary.grant')
  @ApiOperation({ summary: 'Get catalogue of roles available for temporary elevation with permission previews' })
  async getElevationCatalog() {
    return this.tempRoleService.getElevationCatalog();
  }

  @Post()
  @RequirePermissions('roles.temporary.grant')
  @ApiOperation({ summary: 'Grant temporary role to user (3.15.1)' })
  async grantRole(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: GrantTemporaryRoleDto,
  ) {
    return this.tempRoleService.grantTemporaryRole(
      user.userId,
      dto.targetUserId,
      dto.roleId,
      dto.durationHours,
      dto.reason,
      dto.projectId,
    );
  }

  @Get()
  @RequirePermissions('roles.temporary.view')
  @ApiOperation({ summary: 'View active temporary roles (3.15.2)' })
  async listRoles(@Query('status') status?: string) {
    return this.tempRoleService.listTemporaryRoles(status);
  }

  @Get('my-requests')
  @RequirePermissions('roles.temporary.request')
  @ApiOperation({ summary: 'View current user temporary role requests and history (UC-95)' })
  async getMyRequests(@CurrentUser() user: AuthenticatedUser) {
    return this.tempRoleService.getMyRequests(user.userId);
  }

  @Post(':id/revoke')
  @RequirePermissions('roles.temporary.revoke')
  @ApiOperation({ summary: 'Revoke temporary role (3.15.3)' })
  async revokeRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RevokeTemporaryRoleDto,
  ) {
    return this.tempRoleService.revokeTemporaryRole(user.userId, id, dto?.reason);
  }

  @Get('history')
  @RequirePermissions('roles.temporary.history.view')
  @ApiOperation({ summary: 'View temporary role history (3.15.4)' })
  async getHistory() {
    return this.tempRoleService.getHistory();
  }

  @Get('history/export')
  @RequirePermissions('roles.temporary.history.view')
  @ApiOperation({ summary: 'Export temporary role history as CSV (3.15.4)' })
  async exportHistoryCsv(@Res() res: Response) {
    const csv = await this.tempRoleService.exportHistoryCsv();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="temporary-roles-history.csv"');
    res.send(csv);
  }

  @Post('request')
  @RequirePermissions('roles.temporary.request')
  @ApiOperation({ summary: 'Internal staff request temporary role (3.15.5 & UC-95)' })
  async requestRole(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RequestTemporaryRoleDto,
  ) {
    return this.tempRoleService.requestTemporaryRole(
      user.userId,
      dto.roleId,
      dto.durationHours,
      dto.reason,
      dto.projectId,
    );
  }

  @Post('requests/:id/review')
  @RequirePermissions('roles.temporary.requests.review')
  @ApiOperation({ summary: 'Team Lead approve or reject temporary role request (3.15.5 & UC-95)' })
  async reviewRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ReviewTemporaryRoleRequestDto,
  ) {
    return this.tempRoleService.reviewRequest(
      user.userId,
      id,
      dto.approved,
      dto.reason,
      dto.durationHours,
    );
  }

  @Post('cron/expire')
  @RequirePermissions('roles.temporary.manage')
  @ApiOperation({ summary: 'Cron job to expire temporary roles (3.16.7)' })
  async expireRoles() {
    return this.tempRoleService.expireTemporaryRolesCron();
  }
}
