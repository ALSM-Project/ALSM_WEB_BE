import { Body, Controller, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { CurrentSessionGuard } from '../../../shared/security/current-session.guard';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { CreateSalesLeadService } from '../application/create-sales-lead.service';
import { ReassignSalesLeadService } from '../application/reassign-sales-lead.service';
import { ConvertSalesLeadService } from '../application/convert-sales-lead.service';
import { RecordSalesRevenueService } from '../application/record-sales-revenue.service';
import { GetSalesLeadService } from '../application/get-sales-lead.service';
import {
  CreateSalesLeadDto,
  ReassignSalesLeadDto,
  ConvertSalesLeadDto,
  RecordSalesRevenueDto,
} from './sales.dto';
@ApiTags('Sales records')
@ApiBearerAuth()
@ApiHeader({ name: 'x-organization-id', required: true })
@UseGuards(JwtAuthGuard, CurrentSessionGuard)
@Controller('sales')
export class SalesController {
  constructor(
    private readonly createLead: CreateSalesLeadService,
    private readonly reassignLead: ReassignSalesLeadService,
    private readonly convertLead: ConvertSalesLeadService,
    private readonly recordRevenue: RecordSalesRevenueService,
    private readonly getLead: GetSalesLeadService,
  ) {}
  @Post('leads')
  @ApiOperation({
    summary:
      'Record a real sourced lead with its explicit initial assignment; organization OWNER/ADMIN plus users.manage and current session required',
  })
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Headers('x-organization-id') organization: string | undefined,
    @Body() input: CreateSalesLeadDto,
  ) {
    return this.createLead.execute(actor.userId, organization, input);
  }
  @Get('leads/:leadId')
  @ApiOperation({
    summary: 'Authorized administration read of a lead and immutable assignment/conversion history',
  })
  get(
    @CurrentUser() actor: AuthenticatedUser,
    @Headers('x-organization-id') organization: string | undefined,
    @Param('leadId') leadId: string,
  ) {
    return this.getLead.execute(actor.userId, organization, leadId);
  }
  @Post('leads/:leadId/assignments')
  @ApiOperation({
    summary:
      'Authorized revision-checked reassignment, retaining immutable history and conversion credit',
  })
  reassign(
    @CurrentUser() actor: AuthenticatedUser,
    @Headers('x-organization-id') organization: string | undefined,
    @Param('leadId') leadId: string,
    @Body() input: ReassignSalesLeadDto,
  ) {
    return this.reassignLead.execute(actor.userId, organization, leadId, input);
  }
  @Post('leads/:leadId/customer-conversions')
  @ApiOperation({
    summary:
      'Confirm an actual customer conversion against an existing active organization account and business evidence reference',
  })
  convert(
    @CurrentUser() actor: AuthenticatedUser,
    @Headers('x-organization-id') organization: string | undefined,
    @Param('leadId') leadId: string,
    @Body() input: ConvertSalesLeadDto,
  ) {
    return this.convertLead.execute(actor.userId, organization, leadId, input);
  }
  @Post('revenue-attributions')
  @ApiOperation({
    summary:
      'Record actual responsible salesperson for an existing confirmed payment; no amount, status, date or invoice total accepted',
  })
  attribute(
    @CurrentUser() actor: AuthenticatedUser,
    @Headers('x-organization-id') organization: string | undefined,
    @Body() input: RecordSalesRevenueDto,
  ) {
    return this.recordRevenue.execute(actor.userId, organization, input);
  }
}
