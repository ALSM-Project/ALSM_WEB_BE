import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { PermissionsGuard } from '../../../shared/security/permissions.guard';
import { RequirePermissions } from '../../../shared/security/require-permissions.decorator';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { OrganizationUsageService } from '../application/organization-usage.service';
import {
  ListOrganizationUsageQueryDto,
  QuotaAmendmentDto,
  UpdateServiceStatusDto,
} from './organization-usage.dto';

@ApiTags('Admin Organization Usage & Quotas')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('admin/organization-usage')
export class OrganizationUsageController {
  constructor(private readonly usageService: OrganizationUsageService) {}

  @Get('summary')
  @RequirePermissions('billing.usage.view')
  @ApiOperation({ summary: 'Cross-organization usage summary and global quota metrics' })
  async getUsageSummary(
    @Query('scope') scope?: string,
    @Query('organizationType') organizationType?: string,
  ) {
    return this.usageService.getUsageSummary({ scope, organizationType });
  }

  @Get()
  @RequirePermissions('billing.usage.view')
  @ApiOperation({ summary: 'List customer organizations with usage metrics and quota health' })
  async listOrganizationUsage(@Query() query: ListOrganizationUsageQueryDto) {
    return this.usageService.listOrganizationUsage(query);
  }

  @Get(':id')
  @RequirePermissions('billing.usage.view')
  @ApiOperation({ summary: 'Get detailed usage, conversion activity, trends, and quota audit for an organization' })
  async getOrganizationUsageDetail(@Param('id') id: string) {
    return this.usageService.getOrganizationUsageDetail(id);
  }

  @Post(':id/quota-amendment')
  @RequirePermissions('billing.quotes.manage')
  @ApiOperation({ summary: 'Apply authorized quota amendment linked to a contract or approved addendum' })
  async applyQuotaAmendment(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: QuotaAmendmentDto,
  ) {
    return this.usageService.applyQuotaAmendment(id, dto, {
      userId: user.userId,
      email: user.email,
    });
  }

  @Post(':id/service-status')
  @RequirePermissions('billing.quotes.manage')
  @ApiOperation({ summary: 'Suspend or reactivate organization service' })
  async updateServiceStatus(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateServiceStatusDto,
  ) {
    return this.usageService.updateServiceStatus(id, dto, {
      userId: user.userId,
      email: user.email,
    });
  }
}
