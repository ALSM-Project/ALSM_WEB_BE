import { Body, Controller, Get, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { PlatformAdminService } from '../application/platform-admin.service';
import { LockUserService } from '../application/lock-user.service';

@ApiTags('Platform Administration (Sections 3.10, 3.13 & 3.14)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin')
export class PlatformAdminController {
  constructor(
    private readonly adminService: PlatformAdminService,
    private readonly lockUserService: LockUserService,
  ) {}

  @Get('organizations')
  @ApiOperation({ summary: 'View all organisations (3.13.1)' })
  async listOrganizations(
    @Query('search') search?: string,
    @Query('type') type?: string,
    @Query('status') status?: string,
  ) {
    return this.adminService.listOrganizations({ search, type, status });
  }

  @Get('organizations/:id')
  @ApiOperation({ summary: 'View organisation details (3.13.2)' })
  async getOrganizationDetails(@Param('id') id: string) {
    return this.adminService.getOrganizationDetails(id);
  }

  @Post('organizations/enterprise')
  @ApiOperation({ summary: 'Create new Enterprise organisation with Trial (3.13.4)' })
  async createEnterprise(
    @CurrentUser() user: AuthenticatedUser,
    @Body()
    body: {
      name: string;
      domain?: string;
      contactEmail: string;
      engagementType?: string;
      trialDays?: number;
      maxScreens?: number;
      maxPrograms?: number;
      maxStorageGb?: number;
    },
  ) {
    return this.adminService.createEnterpriseOrganization(user.userId, body);
  }

  @Patch('organizations/:id/engagement')
  @ApiOperation({ summary: 'Update organisation engagement limits (3.13.5)' })
  async updateEngagement(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body()
    body: {
      engagementType?: string;
      status?: 'ACTIVE' | 'SUSPENDED' | 'TRIAL';
      trialExpiresAt?: string;
      limits?: { maxScreens: number; maxPrograms: number; maxStorageGb: number };
    },
  ) {
    return this.adminService.updateOrganizationEngagement(user.userId, id, body);
  }

  @Post('organizations/:id/impersonate')
  @ApiOperation({
    summary: 'Organisation Support View unavailable pending security prerequisites (3.10.4)',
    description: 'Authenticated requests fail closed. No support session or customer access is granted.',
  })
  @ApiServiceUnavailableResponse({
    description: 'SUPPORT_IMPERSONATION_UNAVAILABLE: Support View is currently unavailable.',
  })
  async impersonate(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.adminService.impersonateOrganization(user.userId, id);
  }

  @Get('revenue/summary')
  @ApiOperation({
    summary: 'View platform total revenue derived from contracts & payments (3.13.6)',
  })
  async getRevenueSummary() {
    return this.adminService.getTotalRevenue();
  }

  @Get('engagement-types')
  @ApiOperation({ summary: 'List engagement types (3.13.7)' })
  async listEngagementTypes() {
    return this.adminService.listEngagementTypes();
  }

  @Post('engagement-types')
  @ApiOperation({ summary: 'Create new engagement type (3.13.7)' })
  async createEngagementType(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: Record<string, unknown>,
  ) {
    return this.adminService.createEngagementType(user.userId, body);
  }

  @Patch('engagement-types/:id')
  @ApiOperation({ summary: 'Edit engagement type (3.13.8)' })
  async editEngagementType(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.adminService.editEngagementType(user.userId, id, body);
  }

  @Post('users/:id/lock')
  @ApiOperation({ summary: 'Lock user account and revoke sessions (3.13.9)' })
  async lockUser(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body('reason') reason: string,
    @Body('duration') duration?: string,
  ) {
    return this.lockUserService.lock({
      actorUserId: user.userId,
      targetUserId: id,
      reason: reason || 'Violation of platform policies',
      duration,
    });
  }

  @Post('users/:id/unlock')
  @ApiOperation({ summary: 'Unlock user account (3.13.9)' })
  async unlockUser(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.lockUserService.unlock(user.userId, id);
  }

  @Get('users/:id/offboarding-summary')
  @ApiOperation({ summary: 'Get user offboarding resource review summary (3.14.2)' })
  async getOffboardingSummary(@Param('id') id: string) {
    return this.adminService.getOffboardingSummary(id);
  }

  @Post('users/:id/offboard')
  @ApiOperation({ summary: 'Execute user offboarding workflow (3.14.2)' })
  async offboardUser(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body('transferToUserId') transferToUserId?: string,
  ) {
    return this.adminService.offboardUser(user.userId, id, transferToUserId);
  }

  @Post('resources/transfer')
  @ApiOperation({ summary: 'Transfer resource ownership (3.14.3)' })
  async transferResource(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { projectId: string; newAssigneeId: string; reason?: string },
  ) {
    return this.adminService.transferResource(user.userId, body);
  }

  @Get('audit-logs')
  @ApiOperation({ summary: 'View immutable system audit logs (3.13.10)' })
  async listAuditLogs(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('action') action?: string,
    @Query('resourceType') resourceType?: string,
  ) {
    return this.adminService.listAuditLogs({
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
      action,
      resourceType,
    });
  }

  @Get('audit-logs/export')
  @ApiOperation({ summary: 'Export audit logs to CSV (3.13.10)' })
  async exportAuditLogs(@Res() res: Response) {
    const csv = await this.adminService.exportAuditLogsCsv();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="audit-logs.csv"');
    res.send(csv);
  }
}
