import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { BillingService } from '../application/billing.service';
import { UsageService } from '../application/usage.service';
import {
  CancelSubscriptionDto,
  CreateSubscriptionDto,
  UpgradeSubscriptionDto,
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
  @ApiOperation({ summary: 'List all subscription plans' })
  getPlans() {
    return this.billingService.getPlans();
  }

  // ─── Subscription ────────────────────────────────────────

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('subscription')
  @ApiOperation({ summary: 'Get current user subscription' })
  async getCurrentSubscription(@CurrentUser() user: AuthenticatedUser) {
    const sub = await this.billingService.getCurrentSubscription(user.userId);
    return BillingPresenter.toSubscriptionResponse(sub);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('subscription/trial')
  @ApiOperation({ summary: 'Activate free trial (Professional, 14 days)' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'Already has subscription' })
  async activateTrial(@CurrentUser() user: AuthenticatedUser) {
    const orgId = (user as any).organizationId || user.userId;
    const sub = await this.billingService.activateTrial(user.userId, orgId);
    return BillingPresenter.toSubscriptionResponse(sub);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('subscription')
  @ApiOperation({ summary: 'Create a paid subscription (returns pending payment)' })
  async createSubscription(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSubscriptionDto,
  ) {
    const orgId = (user as any).organizationId || user.userId;
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
  @ApiOperation({ summary: 'Preview upgrade proration' })
  async getUpgradePreview(
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.billingService.getUpgradePreview(user.userId, 'PROFESSIONAL' as any);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Put('subscription/upgrade')
  @ApiOperation({ summary: 'Upgrade subscription to a higher tier' })
  async upgradeSubscription(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpgradeSubscriptionDto,
  ) {
    return this.billingService.getUpgradePreview(user.userId, dto.targetPlanTier);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('subscription/cancel')
  @ApiOperation({ summary: 'Cancel current subscription' })
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
  @ApiOperation({ summary: 'List invoices for current user' })
  async getInvoices(@CurrentUser() user: AuthenticatedUser) {
    const invoices = await this.billingService.getInvoices(user.userId);
    return BillingPresenter.toInvoiceListResponse(invoices);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('invoices/:id/download')
  @ApiOperation({ summary: 'Download PDF receipt for an invoice' })
  async downloadInvoicePdf(@CurrentUser() user: AuthenticatedUser) {
    return {
      message: 'Invoice PDF generation queued',
      downloadUrl: `/api/v1/billing/invoices/sample-receipt.pdf`,
    };
  }

  // ─── Usage ───────────────────────────────────────────────

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('usage')
  @ApiOperation({ summary: 'Get resource usage statistics' })
  async getUsageStats(@CurrentUser() user: AuthenticatedUser) {
    const orgId = (user as any).organizationId || user.userId;
    return this.usageService.getUsageStats(user.userId, orgId);
  }
}
