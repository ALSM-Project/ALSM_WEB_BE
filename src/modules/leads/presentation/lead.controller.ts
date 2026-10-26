import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { PermissionsGuard } from '../../../shared/security/permissions.guard';
import { RequirePermissions } from '../../../shared/security/require-permissions.decorator';
import { ListLeadsService } from '../application/list-leads.service';
import { ListLeadsQueryDto } from './lead.dto';
import { LeadStatus, LeadSource, LeadPriority } from '../domain/lead.types';

@ApiTags('Leads (UC-58)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('leads')
export class LeadController {
  constructor(private readonly listLeadsService: ListLeadsService) {}

  @Get()
  @RequirePermissions('sales.leads.view')
  @ApiOperation({
    summary: 'View lead list (UC-58)',
    description:
      'Requires sales.leads.view permission. Returns paginated lead list with filtering, search, and sorting. ' +
      'Accessible by internal_sales staff.',
  })
  @ApiQuery({ name: 'status', required: false, enum: LeadStatus })
  @ApiQuery({ name: 'source', required: false, enum: LeadSource })
  @ApiQuery({ name: 'priority', required: false, enum: LeadPriority })
  @ApiQuery({ name: 'assignedToUserId', required: false, type: String })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'sortBy', required: false, type: String })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] })
  @ApiResponse({ status: 200, description: 'Lead list retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized – invalid or missing token' })
  @ApiResponse({ status: 403, description: 'Forbidden – missing leads.view permission' })
  async list(@Query() query: ListLeadsQueryDto) {
    return this.listLeadsService.execute({
      status: query.status as LeadStatus | undefined,
      source: query.source as LeadSource | undefined,
      priority: query.priority as LeadPriority | undefined,
      assignedToUserId: query.assignedToUserId,
      search: query.search,
      page: query.page ? Number(query.page) : undefined,
      limit: query.limit ? Number(query.limit) : undefined,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    });
  }
}
