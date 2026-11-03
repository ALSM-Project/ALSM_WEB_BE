import { Body, Controller, Get, Headers, Param, Post, StreamableFile, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { CurrentSessionGuard } from '../../../shared/security/current-session.guard';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { PermissionsGuard } from '../../../shared/security/permissions.guard';
import { RequirePermissions } from '../../../shared/security/require-permissions.decorator';
import { ContractAggregateService } from '../application/contract-aggregate.service';
import { CreateContractDto } from './sales.dto';
import { CustomerContractDecisionDto, ReviewContractDto } from './contract-aggregate.dto';

@ApiTags('Online Contract Foundation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CurrentSessionGuard, PermissionsGuard)
@Controller()
export class ContractAggregateController {
  constructor(private readonly contracts: ContractAggregateService) {}

  @Post('sales/crm/leads/:leadId/legal-contracts')
  @RequirePermissions('sales.leads.manage')
  @ApiHeader({ name: 'x-organization-id', required: false })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'UUID; reuse only for the exact same draft request' })
  @ApiOperation({ summary: 'Create a provider-neutral contract draft and immutable version snapshot' })
  @ApiResponse({ status: 201, description: 'Draft saved; no legal template or signing action is implied.' })
  async createDraft(
    @CurrentUser() actor: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string,
    @Headers('idempotency-key') requestId: string,
    @Param('leadId') leadId: string,
    @Body() body: CreateContractDto,
  ) {
    return this.contracts.createDraft({ leadId, organizationId, requestId, body, actor });
  }

  @Get('sales/crm/leads/:leadId/legal-contracts')
  @RequirePermissions('sales.leads.view')
  @ApiHeader({ name: 'x-organization-id', required: false })
  @ApiOperation({ summary: 'List contract metadata in the caller’s Lead scope' })
  async listForSales(
    @CurrentUser() actor: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string,
    @Param('leadId') leadId: string,
  ) {
    return this.contracts.listForSales({ leadId, organizationId, actor });
  }

  @Get('sales/crm/leads/:leadId/legal-contracts/:contractId')
  @RequirePermissions('sales.leads.view')
  @ApiHeader({ name: 'x-organization-id', required: false })
  @ApiOperation({ summary: 'Read contract and current version metadata in the caller’s Lead scope' })
  async getForSales(
    @CurrentUser() actor: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string,
    @Param('leadId') leadId: string,
    @Param('contractId') contractId: string,
  ) {
    return this.contracts.getForSales({ leadId, contractId, organizationId, actor });
  }

  @Get('sales/crm/leads/:leadId/legal-contracts/:contractId/review-pdf')
  @RequirePermissions('sales.leads.view')
  @ApiHeader({ name: 'x-organization-id', required: false })
  @ApiOperation({ summary: 'Download the approved contract review copy (not a signed document)' })
  async getReviewPdfForSales(
    @CurrentUser() actor: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string,
    @Param('leadId') leadId: string,
    @Param('contractId') contractId: string,
  ) {
    const pdf = await this.contracts.getReviewPdfForSales({ leadId, contractId, organizationId, actor });
    return new StreamableFile(pdf.bytes, {
      type: 'application/pdf',
      disposition: `attachment; filename="${pdf.fileName}"`,
      length: pdf.bytes.byteLength,
    });
  }

  @Get('sales/crm/leads/:leadId/legal-contracts/:contractId/contract-pdf')
  @RequirePermissions('sales.leads.view')
  @ApiHeader({ name: 'x-organization-id', required: false })
  @ApiOperation({ summary: 'Download the immutable unsigned contract PDF prepared for signature' })
  async getCanonicalPdfForSales(
    @CurrentUser() actor: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string,
    @Param('leadId') leadId: string,
    @Param('contractId') contractId: string,
  ) {
    const pdf = await this.contracts.getCanonicalPdfForSales({ leadId, contractId, organizationId, actor });
    return new StreamableFile(pdf.bytes, {
      type: 'application/pdf',
      disposition: `attachment; filename="${pdf.fileName}"`,
      length: pdf.bytes.byteLength,
    });
  }

  @Post('sales/crm/leads/:leadId/legal-contracts/:contractId/versions')
  @RequirePermissions('sales.leads.manage')
  @ApiHeader({ name: 'x-organization-id', required: false })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'UUID; reuse only for the exact same revision request' })
  @ApiOperation({ summary: 'Create a new immutable version after a reviewer requests changes' })
  async revise(
    @CurrentUser() actor: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string,
    @Headers('idempotency-key') requestId: string,
    @Param('leadId') leadId: string,
    @Param('contractId') contractId: string,
    @Body() body: CreateContractDto,
  ) {
    return this.contracts.revise({ leadId, contractId, organizationId, requestId, body, actor });
  }

  @Post('sales/crm/leads/:leadId/legal-contracts/:contractId/submit-review')
  @RequirePermissions('sales.leads.manage')
  @ApiHeader({ name: 'x-organization-id', required: false })
  @ApiOperation({ summary: 'Submit an editable draft for internal review' })
  async submitForReview(
    @CurrentUser() actor: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string,
    @Param('leadId') leadId: string,
    @Param('contractId') contractId: string,
  ) {
    return this.contracts.submitForReview({ leadId, contractId, organizationId, actor });
  }

  @Post('sales/crm/leads/:leadId/legal-contracts/:contractId/review')
  @RequirePermissions('sales.contracts.review')
  @ApiHeader({ name: 'x-organization-id', required: false })
  @ApiOperation({ summary: 'Review a submitted contract; approval requires a configured Legal-approved template' })
  async review(
    @CurrentUser() actor: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string,
    @Param('leadId') leadId: string,
    @Param('contractId') contractId: string,
    @Body() body: ReviewContractDto,
  ) {
    return this.contracts.review({ leadId, contractId, organizationId, actor, action: body.action, reason: body.reason });
  }

  @Get('customer/contracts/:contractId')
  @ApiOperation({ summary: 'Read contract metadata for the authenticated user with an accepted Lead invitation' })
  @ApiResponse({ status: 404, description: 'Contract is unavailable to this account' })
  async getForCustomer(@CurrentUser() actor: AuthenticatedUser, @Param('contractId') contractId: string) {
    return this.contracts.getForCustomer(contractId, actor);
  }

  @Post('customer/contracts/:contractId/viewed')
  @ApiOperation({ summary: 'Record the first customer view of an approved contract; repeated calls are idempotent' })
  @ApiResponse({ status: 404, description: 'Contract is unavailable to this account' })
  async recordCustomerViewed(@CurrentUser() actor: AuthenticatedUser, @Param('contractId') contractId: string) {
    return this.contracts.recordCustomerViewed(contractId, actor);
  }

  @Post('customer/contracts/:contractId/decision')
  @ApiOperation({ summary: 'Request changes or decline an approved contract version before provider signing' })
  @ApiResponse({ status: 409, description: 'The contract is no longer open for a customer response' })
  async respondForCustomer(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('contractId') contractId: string,
    @Body() body: CustomerContractDecisionDto,
  ) {
    return this.contracts.respondForCustomer(contractId, actor, body.action, body.reason);
  }

  @Get('customer/contracts/:contractId/review-pdf')
  @ApiOperation({ summary: 'Download the review copy for a contract linked to the authenticated customer account' })
  @ApiResponse({ status: 404, description: 'Contract is unavailable to this account' })
  async getReviewPdfForCustomer(@CurrentUser() actor: AuthenticatedUser, @Param('contractId') contractId: string) {
    const pdf = await this.contracts.getReviewPdfForCustomer(contractId, actor);
    return new StreamableFile(pdf.bytes, {
      type: 'application/pdf',
      disposition: `attachment; filename="${pdf.fileName}"`,
      length: pdf.bytes.byteLength,
    });
  }

  @Get('customer/contracts/:contractId/contract-pdf')
  @ApiOperation({ summary: 'Download the immutable unsigned contract PDF linked to the authenticated customer account' })
  @ApiResponse({ status: 404, description: 'Contract is unavailable to this account' })
  async getCanonicalPdfForCustomer(@CurrentUser() actor: AuthenticatedUser, @Param('contractId') contractId: string) {
    const pdf = await this.contracts.getCanonicalPdfForCustomer(contractId, actor);
    return new StreamableFile(pdf.bytes, {
      type: 'application/pdf',
      disposition: `attachment; filename="${pdf.fileName}"`,
      length: pdf.bytes.byteLength,
    });
  }

  @Get('customer/contracts/:contractId/signed-pdf')
  @ApiOperation({ summary: 'Download the provider-confirmed signed PDF from the verified private evidence archive' })
  @ApiResponse({ status: 404, description: 'Verified signed evidence is unavailable to this account' })
  async getFinalSignedPdfForCustomer(@CurrentUser() actor: AuthenticatedUser, @Param('contractId') contractId: string) {
    const pdf = await this.contracts.getFinalSignedPdfForCustomer(contractId, actor);
    return new StreamableFile(pdf.bytes, {
      type: 'application/pdf',
      disposition: `attachment; filename="${pdf.fileName}"`,
      length: pdf.bytes.byteLength,
    });
  }

  @Get('customer/contracts')
  @ApiOperation({ summary: 'List approved contracts and the authenticated customer’s recorded decisions for active Lead invitations' })
  async listForCustomer(@CurrentUser() actor: AuthenticatedUser) {
    return this.contracts.listForCustomer(actor);
  }
}
