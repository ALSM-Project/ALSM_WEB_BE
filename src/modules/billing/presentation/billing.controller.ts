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
} from '@nestjs/common';
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
  InvoiceDownloadResponseDto,
  InvoiceResponseDto,
  ListQuoteRequestsQueryDto,
  PlanResponseDto,
  QuoteRequestResponseDto,
  RequestEnterpriseQuoteDto,
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
    description: 'Retrieve the static catalog of available subscription plans, features, and pricing.',
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
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Missing or invalid authentication token' })
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
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Missing or invalid authentication token' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'User already has an active subscription or trial' })
  async activateTrial(@CurrentUser() user: AuthenticatedUser) {
    const orgId = (user as AuthenticatedUser & { organizationId?: string }).organizationId || user.userId;
    const sub = await this.billingService.activateTrial(user.userId, orgId);
    return BillingPresenter.toSubscriptionResponse(sub);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('subscription')
  @ApiOperation({
    summary: 'Create a paid subscription',
    description: 'Create a subscription in PENDING_PAYMENT status awaiting bank transfer / QR payment confirmation.',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Subscription created (pending payment)',
    type: SubscriptionResponseDto,
  })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid plan or Enterprise plan requested' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Missing or invalid authentication token' })
  async createSubscription(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSubscriptionDto,
  ) {
    const orgId = (user as AuthenticatedUser & { organizationId?: string }).organizationId || user.userId;
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
    description: 'Calculate remaining credit, prorated target cost, and net amount due today for upgrading.',
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
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Missing or invalid authentication token' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'No active subscription found to upgrade' })
  async getUpgradePreview(
    @CurrentUser() user: AuthenticatedUser,
    @Query('targetTier') targetTier?: PlanTier,
  ) {
    return this.billingService.getUpgradePreview(
      user.userId,
      targetTier || PlanTier.PROFESSIONAL,
    );
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
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Missing or invalid authentication token' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'No active subscription found to upgrade' })
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
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Missing or invalid authentication token' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'User already has a pending Enterprise quote request' })
  async requestEnterpriseQuote(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RequestEnterpriseQuoteDto,
  ) {
    const orgId = (user as AuthenticatedUser & { organizationId?: string }).organizationId || user.userId;
    const request = await this.billingService.requestEnterpriseQuote(user.userId, orgId, dto);
    return BillingPresenter.toQuoteRequestResponse(request);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('enterprise/my-quote-request')
  @ApiOperation({
    summary: 'Get my latest enterprise quote request (UC-32)',
    description: 'Retrieve the most recent enterprise quote request submitted by the authenticated user, regardless of status.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Latest quote request or null if none exists',
    type: QuoteRequestResponseDto,
  })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Missing or invalid authentication token' })
  async getMyQuoteRequest(@CurrentUser() user: AuthenticatedUser) {
    const request = await this.billingService.getMyQuoteRequest(user.userId);
    if (!request) return null;
    return BillingPresenter.toQuoteRequestResponse(request);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('enterprise/quote-requests')
  @ApiOperation({
    summary: 'List enterprise quote requests (Admin only) (UC-32)',
    description: 'Retrieve all enterprise quote requests with optional status filter and pagination. Requires Platform Admin access.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of quote requests and total count',
  })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Missing or invalid authentication token' })
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
    description: 'Update the status of an enterprise quote request (PENDING -> CONTACTED -> CLOSED). Requires Platform Admin access.',
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
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Missing or invalid authentication token' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Requires Platform Admin role' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Quote request not found' })
  async updateQuoteRequestStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateQuoteRequestStatusDto,
  ) {
    const request = await this.billingService.updateQuoteRequestStatus(user, id, dto.status);
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
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Missing or invalid authentication token' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'No active subscription found to cancel' })
  async cancelSubscription(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CancelSubscriptionDto,
  ) {
    return this.billingService.cancelSubscription(
      user.userId,
      dto.reason,
      dto.feedback,
    );
  }

  // ─── Invoices ────────────────────────────────────────────

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('invoices')
  @ApiOperation({
    summary: 'List invoices for current user',
    description: 'Retrieve all historical invoices and billing records for the authenticated user.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of invoices',
    type: [InvoiceResponseDto],
  })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Missing or invalid authentication token' })
  async getInvoices(@CurrentUser() user: AuthenticatedUser) {
    const invoices = await this.billingService.getInvoices(user.userId);
    return BillingPresenter.toInvoiceListResponse(invoices);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('invoices/:id/download')
  @ApiOperation({
    summary: 'Download PDF receipt for an invoice',
    description: 'Generate or retrieve download link for a PDF invoice receipt.',
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
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Missing or invalid authentication token' })
  async downloadInvoicePdf(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return {
      message: `Invoice PDF generation queued for invoice ${id} and user ${user.userId}`,
      downloadUrl: `/api/v1/billing/invoices/${id}/receipt.pdf`,
    };
  }

  // ─── Usage ───────────────────────────────────────────────

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('usage')
  @ApiOperation({
    summary: 'Get resource usage statistics',
    description: 'Get current quota usage (screens, projects, storage) and past monthly conversion volumes.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Resource usage statistics and plan limits',
    type: UsageStatsResponseDto,
  })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Missing or invalid authentication token' })
  async getUsageStats(@CurrentUser() user: AuthenticatedUser) {
    const orgId = (user as AuthenticatedUser & { organizationId?: string }).organizationId || user.userId;
    return this.usageService.getUsageStats(user.userId, orgId);
  }
}
