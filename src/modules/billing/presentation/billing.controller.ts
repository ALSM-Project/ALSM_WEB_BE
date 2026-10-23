import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { BillingService } from '../application/billing.service';
import { UsageService } from '../application/usage.service';
import { PlanTier } from '../domain/billing.types';
import {
  CancelSubscriptionDto,
  CancelSubscriptionResponseDto,
  CreateSubscriptionDto,
  InvoiceDetailResponseDto,
  InvoiceDownloadResponseDto,
  InvoiceResponseDto,
  ListInvoicesQueryDto,
  PaginatedInvoicesResponseDto,
  ListQuoteRequestsQueryDto,
  PlanResponseDto,
  QuoteRequestResponseDto,
  RequestEnterpriseQuoteDto,
  SubmitEnterpriseAppealDto,
  ResolveEnterpriseAppealDto,
  SubscriptionResponseDto,
  UpdateQuoteRequestStatusDto,
  UpgradePreviewResponseDto,
  UpgradeSubscriptionDto,
  UsageStatsResponseDto,
} from './billing.dto';
import { BillingPresenter } from './response/billing.presenter';

@ApiTags('Billing')
@Controller('billing')
export class BillingController {
  constructor(
    private readonly billingService: BillingService,
    private readonly usageService: UsageService,
  ) {}

  // ─── Plans (Public) ──────────────────────────────────────

  @Get('plans')
  @ApiOperation({
    summary: 'List all subscription plans',
    description:
      'Retrieve the static catalog of available subscription plans, features, and pricing.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of subscription plans',
    type: [PlanResponseDto],
  })
  getPlans() {
    return this.billingService.getPlans();
  }

  // ─── Subscription ────────────────────────────────────────

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('subscription')
  @ApiOperation({
    summary: 'Get current user subscription',
    description: 'Retrieve active subscription or trial details for the authenticated user.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Current active subscription or null if none exists',
    type: SubscriptionResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid authentication token',
  })
  async getCurrentSubscription(@CurrentUser() user: AuthenticatedUser) {
    const sub = await this.billingService.getCurrentSubscription(user.userId);
    return BillingPresenter.toSubscriptionResponse(sub);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('subscription/trial')
  @ApiOperation({
    summary: 'Activate free trial (Professional, 14 days)',
    description: 'Activate a 14-day free trial of the Professional plan for the current user.',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Trial activated successfully',
    type: SubscriptionResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid authentication token',
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'User already has an active subscription or trial',
  })
  async activateTrial(@CurrentUser() user: AuthenticatedUser) {
    const orgId =
      (user as AuthenticatedUser & { organizationId?: string }).organizationId || user.userId;
    const sub = await this.billingService.activateTrial(user.userId, orgId);
    return BillingPresenter.toSubscriptionResponse(sub);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('subscription')
  @ApiOperation({
    summary: 'Create a paid subscription',
    description:
      'Create a subscription in PENDING_PAYMENT status awaiting bank transfer / QR payment confirmation.',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Subscription created (pending payment)',
    type: SubscriptionResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid plan or Enterprise plan requested',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid authentication token',
  })
  async createSubscription(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSubscriptionDto,
  ) {
    const orgId =
      (user as AuthenticatedUser & { organizationId?: string }).organizationId || user.userId;
    const sub = await this.billingService.createPaidSubscription(
      user.userId,
      orgId,
      dto.planTier,
      dto.billingCycle,
    );
    return BillingPresenter.toSubscriptionResponse(sub);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('subscription/upgrade-preview')
  @ApiOperation({
    summary: 'Preview upgrade proration',
    description:
      'Calculate remaining credit, prorated target cost, and net amount due today for upgrading.',
  })
  @ApiQuery({
    name: 'targetTier',
    enum: PlanTier,
    required: false,
    description: 'Target plan tier to calculate upgrade preview for (defaults to PROFESSIONAL)',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Upgrade proration preview details',
    type: UpgradePreviewResponseDto,
  })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Target plan tier is invalid' })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid authentication token',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'No active subscription found to upgrade',
  })
  async getUpgradePreview(
    @CurrentUser() user: AuthenticatedUser,
    @Query('targetTier') targetTier?: PlanTier,
  ) {
    return this.billingService.getUpgradePreview(user.userId, targetTier || PlanTier.PROFESSIONAL);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Put('subscription/upgrade')
  @ApiOperation({
    summary: 'Upgrade subscription to a higher tier',
    description: 'Upgrade existing subscription to target tier and preview proration cost.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Upgrade preview and calculated charges',
    type: UpgradePreviewResponseDto,
  })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Target plan tier is invalid' })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid authentication token',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'No active subscription found to upgrade',
  })
  async upgradeSubscription(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpgradeSubscriptionDto,
  ) {
    return this.billingService.getUpgradePreview(user.userId, dto.targetPlanTier);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('enterprise/request-quote')
  @ApiOperation({
    summary: 'Request Enterprise quote for full migration (UC-32)',
    description: 'Submit an enterprise quote request to upgrade to full migration.',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Enterprise quote request submitted successfully',
    type: QuoteRequestResponseDto,
  })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid input data' })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid authentication token',
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'User already has a pending Enterprise quote request',
  })
  async requestEnterpriseQuote(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RequestEnterpriseQuoteDto,
  ) {
    const request = await this.billingService.requestEnterpriseQuote(user, dto);
    return BillingPresenter.toQuoteRequestResponse(request);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('enterprise/my-quote-request')
  @ApiOperation({
    summary: 'Get my latest enterprise quote request (UC-32)',
    description:
      'Retrieve the most recent enterprise quote request submitted by the authenticated user, regardless of status.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Latest quote request or null if none exists',
    type: QuoteRequestResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid authentication token',
  })
  async getMyQuoteRequest(@CurrentUser() user: AuthenticatedUser) {
    const request = await this.billingService.getMyQuoteRequest(user.userId);
    if (!request) return null;
    return BillingPresenter.toQuoteRequestResponse(request);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('enterprise/my-quote-request/appeal')
  @ApiOperation({ summary: 'Submit an appeal for a suspended Enterprise request' })
  async submitEnterpriseAppeal(@CurrentUser() user: AuthenticatedUser, @Body() dto: SubmitEnterpriseAppealDto) {
    const request = await this.billingService.submitQuoteAppeal(user.userId, dto.message);
    return BillingPresenter.toQuoteRequestResponse(request);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('enterprise/quote-requests')
  @ApiOperation({
    summary: 'List enterprise quote requests (Admin only) (UC-32)',
    description:
      'Retrieve all enterprise quote requests with optional status filter and pagination. Requires Platform Admin access.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of quote requests and total count',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid authentication token',
  })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Requires Platform Admin role' })
  async listQuoteRequests(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListQuoteRequestsQueryDto,
  ) {
    const result = await this.billingService.listQuoteRequests(user, query);
    return {
      items: result.items.map((item) => BillingPresenter.toQuoteRequestResponse(item)),
      total: result.total,
    };
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Patch('enterprise/quote-requests/:id/status')
  @ApiOperation({
    summary: 'Update enterprise quote request status (Admin only) (UC-32)',
    description: 'Update an enterprise quote request. APPROVED activates/restores Enterprise access; SUSPENDED blocks access until restored. Requires Platform Admin access.',
  })
  @ApiParam({
    name: 'id',
    description: 'Quote request ID',
    example: '66d9c84e1234567890abcdef',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Quote request status updated successfully',
    type: QuoteRequestResponseDto,
  })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid status transition' })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid authentication token',
  })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Requires Platform Admin role' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Quote request not found' })
  async updateQuoteRequestStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateQuoteRequestStatusDto,
  ) {
    const request = await this.billingService.updateQuoteRequestStatus(user, id, dto.status, dto.reason);
    return BillingPresenter.toQuoteRequestResponse(request);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Patch('enterprise/quote-requests/:id/appeal')
  @ApiOperation({ summary: 'Approve or decline a customer appeal (Admin only)' })
  async resolveEnterpriseAppeal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ResolveEnterpriseAppealDto,
  ) {
    const request = await this.billingService.resolveQuoteAppeal(user, id, dto.decision, dto.response);
    return BillingPresenter.toQuoteRequestResponse(request);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('subscription/cancel')
  @ApiOperation({
    summary: 'Cancel current subscription',
    description: 'Cancel active subscription. Access remains valid until current period end date.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Subscription cancelled successfully',
    type: CancelSubscriptionResponseDto,
  })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid cancel request' })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid authentication token',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'No active subscription found to cancel',
  })
  async cancelSubscription(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CancelSubscriptionDto,
  ) {
    return this.billingService.cancelSubscription(user.userId, dto.reason, dto.feedback);
  }

  // ─── Invoices (View Invoices Workflow) ────────────────────

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('invoices')
  @ApiOperation({
    summary: 'List invoices for current user or organization',
    description: 'Retrieve historical invoices and billing records for the enterprise customer, enterprise admin, or organization member.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of invoices or paginated result',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid authentication token',
  })
  async getInvoices(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListInvoicesQueryDto,
  ) {
    const result = await this.billingService.getInvoices(user, query);
    // If client explicitly requested pagination parameters
    if (query?.page || query?.limit) {
      return {
        items: BillingPresenter.toInvoiceListResponse(result.items),
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
      };
    }
    // Backward-compatible array response for clients expecting a direct array
    return BillingPresenter.toInvoiceListResponse(result.items);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('invoices/:id')
  @ApiOperation({
    summary: 'Get invoice details by ID',
    description: 'Retrieve full breakdown of an invoice including line items, VAT, and payment details.',
  })
  @ApiParam({
    name: 'id',
    description: 'Invoice identifier (MongoDB ObjectId)',
    example: '66d9c84e1234567890abcdef',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Detailed invoice breakdown',
    type: InvoiceDetailResponseDto,
  })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid invoice ID format' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Missing or invalid authentication token' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Access denied to this invoice' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Invoice not found' })
  async getInvoiceById(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const invoice = await this.billingService.getInvoiceById(user, id);
    return BillingPresenter.toInvoiceDetailResponse(invoice);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('invoices/:id/receipt.pdf')
  @ApiOperation({
    summary: 'Stream or download PDF receipt for an invoice',
    description: 'Generates and streams standard PDF receipt with headers for inline viewing or download.',
  })
  @ApiParam({
    name: 'id',
    description: 'Invoice identifier (MongoDB ObjectId)',
    example: '66d9c84e1234567890abcdef',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'PDF binary stream',
  })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid invoice ID format' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Missing or invalid authentication token' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Access denied to this invoice' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Invoice not found' })
  async streamInvoicePdf(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const pdfData = await this.billingService.downloadInvoicePdf(user, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${pdfData.filename}"`);
    res.send(pdfData.buffer);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('invoices/:id/download')
  @ApiOperation({
    summary: 'Download PDF receipt metadata for an invoice',
    description: 'Generate or retrieve download link and metadata for a PDF invoice receipt.',
  })
  @ApiParam({
    name: 'id',
    description: 'Invoice identifier (MongoDB ObjectId)',
    example: '66d9c84e1234567890abcdef',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Invoice download URL and status',
    type: InvoiceDownloadResponseDto,
  })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid invoice ID format' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Missing or invalid authentication token' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Access denied to this invoice' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Invoice not found' })
  async downloadInvoicePdf(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const detail = await this.billingService.getInvoiceById(user, id);
    return {
      message: 'Invoice PDF ready for download',
      downloadUrl: `/api/v1/billing/invoices/${id}/receipt.pdf`,
      invoiceNumber: detail.invoiceNumber,
      filename: `${detail.invoiceNumber}.pdf`,
    };
  }

  // ─── Usage ───────────────────────────────────────────────

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('usage')
  @ApiOperation({
    summary: 'Get resource usage statistics',
    description:
      'Get current quota usage (screens, projects, storage) and past monthly conversion volumes.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Resource usage statistics and plan limits',
    type: UsageStatsResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid authentication token',
  })
  async getUsageStats(@CurrentUser() user: AuthenticatedUser) {
    const orgId =
      (user as AuthenticatedUser & { organizationId?: string }).organizationId || user.userId;
    return this.usageService.getUsageStats(user.userId, orgId);
  }
}
