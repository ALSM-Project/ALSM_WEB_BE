import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { PermissionsGuard } from '../../../shared/security/permissions.guard';
import { RequirePermissions } from '../../../shared/security/require-permissions.decorator';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { ListLeadsService } from '../application/list-leads.service';
import { UpdateLeadStatusService } from '../application/update-lead-status.service';
import { SendQuoteService } from '../application/send-quote.service';
import { CreateLeadService } from '../application/create-lead.service';
import { CreateLeadDto, ListLeadsQueryDto, UpdateLeadStatusDto, SendQuoteDto } from './lead.dto';
import { LeadStatus, LeadSource, LeadPriority, LeadRecord, LeadQuoteItem } from '../domain/lead.types';
import { SendQuoteResult } from '../application/send-quote.service';

@ApiTags('Leads (UC-58, UC-59, UC-62, UC-66, UC-67)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('leads')
export class LeadController {
  constructor(
    private readonly listLeadsService: ListLeadsService,
    private readonly updateLeadStatusService: UpdateLeadStatusService,
    private readonly sendQuoteService: SendQuoteService,
    private readonly createLeadService: CreateLeadService,
  ) {}

  @Post()
  @RequirePermissions('sales.leads.manage')
  @ApiOperation({
    summary: 'Create a new sales lead (UC-59)',
    description: 'Requires sales.leads.manage. Creates the lead, assigns it to the authenticated sales user, and writes an audit event atomically.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Stable UUID reused when retrying the same lead creation request',
  })
  @ApiResponse({ status: 201, description: 'Lead created or an identical retry reconciled' })
  @ApiResponse({ status: 400, description: 'Invalid lead details or missing idempotency key' })
  @ApiResponse({ status: 401, description: 'Authentication is required' })
  @ApiResponse({ status: 403, description: 'The user lacks sales.leads.manage permission' })
  @ApiResponse({ status: 409, description: 'Duplicate email or idempotency key reused with different details' })
  @ApiResponse({ status: 503, description: 'The database transaction could not be completed' })
  async create(
    @Body() dto: CreateLeadDto,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('idempotency-key') requestId?: string,
  ) {
    const result = await this.createLeadService.execute(dto, user, requestId);
    return { ...result, lead: this.publicLead(result.lead) };
  }

  @Post(':id/notification')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('sales.leads.manage')
  @ApiOperation({
    summary: 'Send or retry contact notification email (UC-59)',
    description: 'Sends the lead contact a notification email. A successful notification is never sent twice.',
  })
  @ApiParam({ name: 'id', description: 'Lead ID (24-hex ObjectId)' })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'UUID for this email send attempt' })
  @ApiResponse({ status: 200, description: 'Notification status returned' })
  @ApiResponse({ status: 400, description: 'Invalid lead ID or idempotency key' })
  @ApiResponse({ status: 401, description: 'Authentication is required' })
  @ApiResponse({ status: 403, description: 'The user lacks sales.leads.manage permission' })
  @ApiResponse({ status: 404, description: 'Lead not found' })
  async notifyContact(
    @Param('id') id: string,
    @Headers('idempotency-key') requestId?: string,
  ) {
    const result = await this.createLeadService.notifyContact(id, requestId);
    return { ...result, lead: this.publicLead(result.lead) };
  }

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
    const result = await this.listLeadsService.execute({
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
    return { ...result, items: result.items.map((lead) => this.publicLead(lead)) };
  }

  @Get(':id')
  @RequirePermissions('sales.leads.view')
  @ApiOperation({
    summary: 'View lead details (UC-67)',
    description: 'Requires sales.leads.view permission. Returns the current full lead record without changing it.',
  })
  @ApiParam({ name: 'id', description: 'Lead ID (24-hex ObjectId)' })
  @ApiResponse({ status: 200, description: 'Lead retrieved successfully' })
  @ApiResponse({ status: 400, description: 'Invalid lead identifier' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Lead not found' })
  async getById(@Param('id') id: string) {
    const lead = await this.listLeadsService.findById(id);
    return this.publicLead(lead);
  }

  @Patch(':id/status')
  @RequirePermissions('sales.leads.manage')
  @ApiOperation({
    summary: 'Update lead status (UC-66)',
    description:
      'Requires sales.leads.manage permission. Validates allowed status transitions and business rules, ' +
      'persists changes, and logs audit events. Accessible by internal_sales staff.',
  })
  @ApiParam({ name: 'id', description: 'Lead ID (24-hex ObjectId)' })
  @ApiResponse({ status: 200, description: 'Lead status updated successfully' })
  @ApiResponse({ status: 400, description: 'Bad request – invalid ID, invalid status, or disallowed transition' })
  @ApiResponse({ status: 401, description: 'Unauthorized – invalid or missing token' })
  @ApiResponse({ status: 403, description: 'Forbidden – missing sales.leads.manage permission' })
  @ApiResponse({ status: 404, description: 'Lead not found' })
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateLeadStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.updateLeadStatusService.execute(id, dto.status, dto.notes, user);
  }

  @Post(':id/quotes')
  @RequirePermissions('sales.leads.manage')
  @ApiOperation({
    summary: 'Send modernization quote to lead (UC-62)',
    description:
      'Requires sales.leads.manage permission. Validates quote parameters, creates quote record, ' +
      'transitions lead status to PROPOSAL, and audits action. Accessible by internal_sales staff.',
  })
  @ApiParam({ name: 'id', description: 'Lead ID (24-hex ObjectId)' })
  @ApiResponse({ status: 201, description: 'Quote sent successfully and lead updated' })
  @ApiResponse({ status: 400, description: 'Bad request – invalid amount, discount, or missing discount reason' })
  @ApiResponse({ status: 401, description: 'Unauthorized – invalid or missing token' })
  @ApiResponse({ status: 403, description: 'Forbidden – missing sales.leads.manage permission' })
  @ApiResponse({ status: 404, description: 'Lead not found' })
  async sendQuote(
    @Param('id') id: string,
    @Body() dto: SendQuoteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.publicQuoteResult(await this.sendQuoteService.execute(id, dto, user));
  }

  @Post(':id/send-quote')
  @RequirePermissions('sales.leads.manage')
  @ApiOperation({
    summary: 'Send modernization quote to lead – alias endpoint (UC-62)',
  })
  async sendQuoteAlias(
    @Param('id') id: string,
    @Body() dto: SendQuoteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.publicQuoteResult(await this.sendQuoteService.execute(id, dto, user));
  }

  private publicLead(lead: LeadRecord): Omit<LeadRecord, 'quotes'> & { quotes?: Array<Omit<LeadQuoteItem, 'requestFingerprint'>> } {
    if (!lead.quotes) return lead as Omit<LeadRecord, 'quotes'> & { quotes?: Array<Omit<LeadQuoteItem, 'requestFingerprint'>> };
    return {
      ...lead,
      quotes: lead.quotes.map((item) => {
        const { requestFingerprint, ...quote } = item;
        void requestFingerprint;
        return quote;
      }),
    };
  }

  private publicQuoteResult(result: SendQuoteResult) {
    const { requestFingerprint, ...quote } = result.quote;
    void requestFingerprint;
    return { ...result, quote, lead: this.publicLead(result.lead) };
  }
}

