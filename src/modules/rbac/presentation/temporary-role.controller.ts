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
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { TemporaryRoleService } from '../application/temporary-role.service';

@ApiTags('Temporary Role Management (Section 3.15)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('rbac/temporary-roles')
export class TemporaryRoleController {
  constructor(private readonly tempRoleService: TemporaryRoleService) {}

  @Post()
  @ApiOperation({ summary: 'Grant temporary role to user (3.15.1)' })
  async grantRole(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { targetUserId: string; roleId: string; durationHours: number; reason: string },
  ) {
    return this.tempRoleService.grantTemporaryRole(
      user.userId,
      body.targetUserId,
      body.roleId,
      body.durationHours,
      body.reason,
    );
  }

  @Get()
  @ApiOperation({ summary: 'View active temporary roles (3.15.2)' })
  async listRoles(@Query('status') status?: string) {
    return this.tempRoleService.listTemporaryRoles(status);
  }

  @Post(':id/revoke')
  @ApiOperation({ summary: 'Revoke temporary role (3.15.3)' })
  async revokeRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body('reason') reason?: string,
  ) {
    return this.tempRoleService.revokeTemporaryRole(user.userId, id, reason);
  }

  @Get('history')
  @ApiOperation({ summary: 'View temporary role history (3.15.4)' })
  async getHistory() {
    return this.tempRoleService.getHistory();
  }

  @Get('history/export')
  @ApiOperation({ summary: 'Export temporary role history as CSV (3.15.4)' })
  async exportHistoryCsv(@Res() res: Response) {
    const csv = await this.tempRoleService.exportHistoryCsv();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="temporary-roles-history.csv"');
    res.send(csv);
  }

  @Post('request')
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
  @ApiOperation({ summary: 'Team Lead approve or reject temporary role request (3.15.5)' })
  async reviewRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: { approved: boolean; reason?: string },
  ) {
    return this.tempRoleService.reviewRequest(user.userId, id, body.approved, body.reason);
  }

  @Post('cron/expire')
  @ApiOperation({ summary: 'Cron job to expire temporary roles (3.16.7)' })
  async expireRoles() {
    return this.tempRoleService.expireTemporaryRolesCron();
  }
}
