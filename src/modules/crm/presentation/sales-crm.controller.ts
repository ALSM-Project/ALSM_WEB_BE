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
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import {
  CreateCrmLeadDto,
  CreateContractDto,
  LogCallDto,
  SalesCrmService,
  ScheduleDemoDto,
  SendQuoteDto,
} from '../application/sales-crm.service';

@ApiTags('CRM & Sales (Sections 3.11 & 3.12)')
@ApiBearerAuth()
@ApiHeader({ name: 'x-organization-id', required: false })
@UseGuards(JwtAuthGuard)
@Controller('sales/crm')
export class SalesCrmController {
  constructor(private readonly crmService: SalesCrmService) {}

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
    return this.crmService.createLead(user.userId, organizationId, dto);
  }

  @Get('leads/:id')
  @ApiOperation({ summary: 'Get CRM lead details (3.11.2)' })
  async getLead(@Param('id') id: string) {
    return this.crmService.getLead(id);
  }

  @Patch('leads/:id/stage')
  @ApiOperation({ summary: 'Update CRM lead stage / Kanban move (3.11.10)' })
  async updateStage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body('stage') stage: 'NEW' | 'CONTACTED' | 'QUALIFIED' | 'PROPOSAL' | 'WON' | 'LOST',
  ) {
    return this.crmService.updateStage(user.userId, id, stage);
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
  ) {
    return this.crmService.sendQuote(user.userId, id, dto);
  }

  @Post('leads/:id/contracts')
  @ApiOperation({ summary: 'Create electronic service contract (3.11.7)' })
  async createContract(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateContractDto,
  ) {
    return this.crmService.createContract(user.userId, id, dto);
  }

  @Post('leads/:id/contracts/:contractId/sign')
  @ApiOperation({ summary: 'Confirm contract signed and auto-provision (3.11.8)' })
  async signContract(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('contractId') contractId: string,
  ) {
    return this.crmService.signContract(user.userId, id, contractId);
  }

  @Get('reports')
  @ApiOperation({ summary: 'View comprehensive sales reports (3.12.1)' })
  async getReports(@Query('teamId') teamId?: string) {
    return this.crmService.getSalesReports(teamId);
  }

  @Get('reports/export')
  @ApiOperation({ summary: 'Export sales reports to CSV (3.12.1)' })
  async exportCsv(@Res() res: Response) {
    const csv = await this.crmService.exportSalesReportsCsv();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="sales-report.csv"');
    res.send(csv);
  }

  @Get('discounts/pending')
  @ApiOperation({ summary: 'List pending discount approval requests (3.12.3)' })
  async getPendingDiscounts() {
    return this.crmService.getPendingDiscounts();
  }

  @Post('discounts/review')
  @ApiOperation({ summary: 'Approve or reject discount request (3.12.3)' })
  async reviewDiscount(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { leadId: string; quoteId: string; approved: boolean; reason?: string },
  ) {
    return this.crmService.reviewDiscount(
      user.userId,
      body.leadId,
      body.quoteId,
      body.approved,
      body.reason,
    );
  }
}
