import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { PaymentService } from '../application/payment.service';
import { CassoWebhookPayload, CreatePaymentDto } from './billing.dto';

@ApiTags('Payment')
@Controller('billing/payment')
export class PaymentController {
  private readonly logger = new Logger(PaymentController.name);

  constructor(private readonly paymentService: PaymentService) {}

  // ─── Create Payment Order + QR ───────────────────────────

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('create')
  @ApiOperation({ summary: 'Create payment order with QR code' })
  async createPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePaymentDto,
  ) {
    const amountVnd = dto.amountVnd || (dto.billingCycle === 'ANNUAL' ? 14990000 : 1499000);
    return this.paymentService.createQRPayment(
      user.userId,
      (user as any).organizationId || user.userId,
      dto.planTier,
      amountVnd,
    );
  }

  // ─── Poll Payment Status ─────────────────────────────────

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get(':paymentId/status')
  @ApiOperation({ summary: 'Check payment status (for polling)' })
  async getPaymentStatus(@Param('paymentId') paymentId: string) {
    return this.paymentService.getPaymentStatus(paymentId);
  }

  // ─── Casso Webhook (Public) ──────────────────────────────

  @Post('/webhook/casso')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Casso bank webhook receiver (public)' })
  async handleCassoWebhook(
    @Headers('authorization') authHeader: string,
    @Body() payload: CassoWebhookPayload,
  ) {
    this.logger.log('Received Casso webhook');

    // Validate the webhook auth
    const isValid = this.paymentService.validateCassoWebhook(authHeader);
    if (!isValid) {
      this.logger.warn('Invalid Casso webhook authorization');
      throw new UnauthorizedException('Invalid webhook authorization');
    }

    if (payload.error && payload.error !== 0) {
      this.logger.warn(`Casso webhook error: ${payload.error}`);
      return { success: false, error: 'Casso reported an error' };
    }

    const transactions = payload.data || [];
    if (transactions.length === 0) {
      return { success: true, message: 'No transactions to process' };
    }

    const result = await this.paymentService.handleCassoWebhook(transactions);
    return { success: true, ...result };
  }
}
