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

@ApiTags('Temporary Role Management (Section 3.15)')
@ApiBearerAuth()
// Every route needs its own permission: without it any signed-in user could raise their own role.
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('rbac/temporary-roles')
export class TemporaryRoleController {
  constructor(private readonly tempRoleService: TemporaryRoleService) {}

  @Post()
  @RequirePermissions('roles.temporary.grant')
  @ApiOperation({ summary: 'Grant temporary role to user (3.15.1)' })
  async grantRole(
    @CurrentUser() user: AuthenticatedUser,
    @Body()
    body: {
      targetUserId: string;
      roleId: string;
      durationHours: number;
      reason: string;
      /** Optional project the elevation is meant for. */
      projectId?: string;
    },
  ) {
    return this.tempRoleService.grantTemporaryRole(
      user.userId,
      body.targetUserId,
      body.roleId,
      body.durationHours,
      body.reason,
      body.projectId,
    );
  }

  @Get()
  @RequirePermissions('roles.temporary.view')
  @ApiOperation({ summary: 'View active temporary roles (3.15.2)' })
  async listRoles(@Query('status') status?: string) {
    return this.tempRoleService.listTemporaryRoles(status);
  }

  @Post(':id/revoke')
  @RequirePermissions('roles.temporary.revoke')
  @ApiOperation({ summary: 'Revoke temporary role (3.15.3)' })
  async revokeRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body('reason') reason?: string,
  ) {
    return this.tempRoleService.revokeTemporaryRole(user.userId, id, reason);
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
  @ApiOperation({ summary: 'Internal staff request temporary role (3.15.5)' })
  async requestRole(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { roleId: string; durationHours: number; reason: string },
  ) {
    return this.tempRoleService.requestTemporaryRole(
      user.userId,
      body.roleId,
      body.durationHours,
      body.reason,
    );
  }

  @Post('requests/:id/review')
  @RequirePermissions('roles.temporary.requests.review')
  @ApiOperation({ summary: 'Team Lead approve or reject temporary role request (3.15.5)' })
  async reviewRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: { approved: boolean; reason?: string },
  ) {
    return this.tempRoleService.reviewRequest(user.userId, id, body.approved, body.reason);
  }

  @Post('cron/expire')
  @RequirePermissions('roles.temporary.manage')
  @ApiOperation({ summary: 'Cron job to expire temporary roles (3.16.7)' })
  async expireRoles() {
    return this.tempRoleService.expireTemporaryRolesCron();
  }
}
