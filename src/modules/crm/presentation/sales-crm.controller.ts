import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { CurrentSessionGuard } from '../../../shared/security/current-session.guard';
import { PermissionsGuard } from '../../../shared/security/permissions.guard';
import { RequirePermissions } from '../../../shared/security/require-permissions.decorator';
import {
  CreateCrmLeadDto,
  LogCallDto,
  SalesCrmService,
  ScheduleDemoDto,
  SendQuoteDto,
} from '../application/sales-crm.service';
import { CreateContractService } from '../application/create-contract.service';
import { ActivateCrmLeadService } from '../application/activate-crm-lead.service';
import { CreateContractDto } from './sales.dto';
import { SalesPipelineQueryDto } from './sales-pipeline-query.dto';
import { SalesReportQueryDto } from './sales-report-query.dto';
import { TeamAccessService } from '../../teams/application/team-access.service';
import { ReviewDiscountService } from '../application/review-discount.service';
import { DiscountRequestDto, RejectDiscountDto } from './discount-review.dto';

@ApiTags('CRM & Sales (Sections 3.11 & 3.12)')
@ApiBearerAuth()
@ApiHeader({ name: 'x-organization-id', required: false })
@UseGuards(JwtAuthGuard)
@Controller('sales/crm')
export class SalesCrmController {
  constructor(
    private readonly crmService: SalesCrmService,
    private readonly createContractService: CreateContractService,
    private readonly activateCrmLeadService: ActivateCrmLeadService,
    private readonly teamAccess: TeamAccessService,
    private readonly reviewDiscountService: ReviewDiscountService,
  ) {}

  @Get('pipeline')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('sales.leads.view')
  @ApiOperation({ summary: 'View the sales pipeline board (UC-65)' })
  async getSalesPipeline(
    @Headers('x-organization-id') organizationId: string | undefined,
    @Query() query: SalesPipelineQueryDto,
  ) {
    return this.crmService.getSalesPipeline({ ...query, organizationId });
  }

  @Get('leads')
  @ApiOperation({ summary: 'List CRM leads with filters (3.11.1)' })
  async listLeads(
    @Headers('x-organization-id') organizationId: string | undefined,
    @Query('stage') stage?: string,
    @Query('search') search?: string,
  ) {
    return this.crmService.listLeads(organizationId, { stage, search });
  }

  @Post('leads')
  @ApiOperation({ summary: 'Create new CRM lead (3.11.3)' })
  async createLead(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Body() dto: CreateCrmLeadDto,
  ) {
    const organization = await this.teamAccess.reportingOrganization(user.userId, organizationId);
    return this.crmService.createLead(user.userId, organization.id, dto);
  }

  @Get('leads/:id')
  @ApiOperation({ summary: 'Get CRM lead details (3.11.2)' })
  async getLead(@Param('id') id: string) {
    return this.crmService.getLead(id);
  }

  @Patch('leads/:id/stage')
  @UseGuards(CurrentSessionGuard, PermissionsGuard)
  @RequirePermissions('sales.leads.manage')
  @ApiOperation({ summary: 'Update CRM lead stage / Kanban move (3.11.10)' })
  async updateStage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body('stage') stage: 'NEW' | 'CONTACTED' | 'QUALIFIED' | 'PROPOSAL' | 'WON' | 'LOST',
  ) {
    return this.crmService.updateStage(user.userId, id, stage);
  }

  @Post('leads/:id/activate')
  @UseGuards(CurrentSessionGuard, PermissionsGuard)
  @RequirePermissions('sales.leads.manage')
  @ApiOperation({ summary: 'Convert a signed CRM lead into a customer organization and mark it Won (UC-64)' })
  @ApiResponse({ status: 400, description: 'The lead is missing a signed contract or valid customer details' })
  @ApiResponse({ status: 403, description: 'The user lacks sales.leads.manage permission' })
  @ApiResponse({ status: 409, description: 'The lead was already converted or changed concurrently' })
  @ApiResponse({ status: 503, description: 'Customer conversion failed and the transaction was rolled back' })
  async activateCustomer(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.activateCrmLeadService.execute(user.userId, id);
  }

  @Post('leads/:id/interactions')
  @ApiOperation({ summary: 'Log phone call / interaction (3.11.4)' })
  async logInteraction(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: LogCallDto,
  ) {
    return this.crmService.logInteraction(user.userId, id, dto);
  }

  @Post('leads/:id/demos')
  @ApiOperation({ summary: 'Schedule product demo with Meet link (3.11.5)' })
  async scheduleDemo(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ScheduleDemoDto,
  ) {
    return this.crmService.scheduleDemo(user.userId, id, dto);
  }

  @Post('leads/:id/quotes')
  @ApiOperation({ summary: 'Create and send pricing quote (3.11.6)' })
  async sendQuote(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SendQuoteDto,
    @Headers('x-organization-id') organizationId: string | undefined,
  ) {
    const organization = await this.teamAccess.reportingOrganization(user.userId, organizationId);
    return this.crmService.sendQuote(user.userId, id, dto, organization.id);
  }

  @Post('leads/:id/contracts')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('sales.leads.manage')
  @ApiOperation({ summary: 'Create a contract draft for a sales lead (UC-63)' })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'UUID reused only when retrying the same contract submission' })
  @ApiResponse({ status: 201, description: 'Contract draft created or an identical retry reconciled' })
  @ApiResponse({ status: 400, description: 'Invalid contract data, lead state, or quote association' })
  @ApiResponse({ status: 401, description: 'Authentication is required' })
  @ApiResponse({ status: 403, description: 'The user lacks sales.leads.manage permission' })
  @ApiResponse({ status: 404, description: 'Lead or selected quote not found' })
  @ApiResponse({ status: 409, description: 'Idempotency key reuse or concurrent lead change' })
  @ApiResponse({ status: 503, description: 'The database transaction could not be completed' })
  async createContract(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateContractDto,
    @Headers('idempotency-key') requestId?: string,
  ) {
    return this.createContractService.execute(id, dto, user, requestId);
  }

  @Post('leads/:id/contracts/:contractId/send')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('sales.leads.manage')
  @ApiOperation({ summary: 'Send a draft contract for electronic signature and notify the customer account' })
  async sendContractForSignature(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('contractId') contractId: string,
  ) {
    return this.crmService.sendContractForSignature(user.userId, id, contractId);
  }

  @Post('leads/:id/contracts/:contractId/sign')
  @UseGuards(CurrentSessionGuard, PermissionsGuard)
  @RequirePermissions('sales.leads.manage')
  @ApiOperation({ summary: 'Mark a contract as signed; customer conversion is a separate UC-64 action' })
  async signContract(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('contractId') contractId: string,
  ) {
    return this.crmService.signContract(user.userId, id, contractId);
  }

  @Get('reports')
  @UseGuards(CurrentSessionGuard, PermissionsGuard)
  @RequirePermissions('sales.reports.view')
  @ApiOperation({ summary: 'View organization-scoped sales reports (UC-68)' })
  async getReports(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Query() query: SalesReportQueryDto,
  ) {
    const organization = await this.teamAccess.reportingOrganization(user.userId, organizationId);
    return this.crmService.getSalesReports(organization.id, query.dateRange);
  }

  @Get('reports/export')
  @UseGuards(CurrentSessionGuard, PermissionsGuard)
  @RequirePermissions('sales.reports.view')
  @ApiOperation({ summary: 'Export organization-scoped sales reports to CSV (UC-68)' })
  async exportCsv(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Query() query: SalesReportQueryDto,
    @Res() res: Response,
  ) {
    const organization = await this.teamAccess.reportingOrganization(user.userId, organizationId);
    const csv = await this.crmService.exportSalesReportsCsv(organization.id, query.dateRange);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="sales-report.csv"');
    res.send(csv);
  }

  @Get('discounts/requests')
  @UseGuards(CurrentSessionGuard, PermissionsGuard)
  @RequirePermissions('sales.discounts.view')
  @ApiOperation({ summary: 'List persisted discount requests for authorized Sales staff (UC-70)' })
  async getDiscountRequests(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
  ) {
    const organization = await this.teamAccess.reportingOrganization(user.userId, organizationId);
    return this.crmService.getDiscountRequests(organization.id);
  }

  @Post('discounts/approve')
  @UseGuards(CurrentSessionGuard, PermissionsGuard)
  @RequirePermissions('sales.discounts.approve')
  @ApiOperation({ summary: 'Approve a discount within the Sales Manager authority limit (UC-70)' })
  async approveDiscount(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Body() body: DiscountRequestDto,
  ) {
    const organization = await this.teamAccess.reportingOrganization(user.userId, organizationId);
    return this.reviewDiscountService.execute({ ...body, organizationId: organization.id, actorUserId: user.userId, outcome: 'APPROVE' });
  }

  @Post('discounts/reject')
  @UseGuards(CurrentSessionGuard, PermissionsGuard)
  @RequirePermissions('sales.discounts.reject')
  @ApiOperation({ summary: 'Reject a discount with a recorded reason' })
  async rejectDiscount(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Body() body: RejectDiscountDto,
  ) {
    const organization = await this.teamAccess.reportingOrganization(user.userId, organizationId);
    return this.reviewDiscountService.execute({ ...body, organizationId: organization.id, actorUserId: user.userId, outcome: 'REJECT' });
  }

  @Post('discounts/escalate')
  @UseGuards(CurrentSessionGuard, PermissionsGuard)
  @RequirePermissions('sales.discounts.approve')
  @ApiOperation({ summary: 'Escalate a discount above the manager limit for higher approval' })
  async escalateDiscount(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Body() body: DiscountRequestDto,
  ) {
    const organization = await this.teamAccess.reportingOrganization(user.userId, organizationId);
    return this.reviewDiscountService.execute({ ...body, organizationId: organization.id, actorUserId: user.userId, outcome: 'ESCALATE' });
  }

  @Post('discounts/executive/approve')
  @UseGuards(CurrentSessionGuard, PermissionsGuard)
  @RequirePermissions('sales.discounts.executive.review')
  @ApiOperation({ summary: 'Approve an escalated discount above the Sales Manager authority limit (UC-70)' })
  async approveEscalatedDiscount(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Body() body: DiscountRequestDto,
  ) {
    const organization = await this.teamAccess.reportingOrganization(user.userId, organizationId);
    return this.reviewDiscountService.execute({ ...body, organizationId: organization.id, actorUserId: user.userId, outcome: 'EXECUTIVE_APPROVE' });
  }

  @Post('discounts/executive/reject')
  @UseGuards(CurrentSessionGuard, PermissionsGuard)
  @RequirePermissions('sales.discounts.executive.review')
  @ApiOperation({ summary: 'Reject an escalated discount with a recorded reason (UC-70)' })
  async rejectEscalatedDiscount(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Body() body: RejectDiscountDto,
  ) {
    const organization = await this.teamAccess.reportingOrganization(user.userId, organizationId);
    return this.reviewDiscountService.execute({ ...body, organizationId: organization.id, actorUserId: user.userId, outcome: 'EXECUTIVE_REJECT' });
  }
}
