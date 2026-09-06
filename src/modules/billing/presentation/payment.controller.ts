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
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { PaymentService } from '../application/payment.service';
import {
  CassoWebhookPayload,
  CassoWebhookResponseDto,
  CreatePaymentDto,
  PaymentOrderResponseDto,
  PaymentStatusResponseDto,
} from './billing.dto';

@ApiTags('Billing - Payments')
@Controller('billing/payment')
export class PaymentController {
  private readonly logger = new Logger(PaymentController.name);

  constructor(private readonly paymentService: PaymentService) {}

  @Get('bank-config')
  @ApiOperation({
    summary: 'Get active payment bank configuration',
    description: 'Retrieves the active bank account details used for VietQR code generation from MongoDB.',
  })
  async getBankConfig() {
    return this.paymentService.getBankConfig();
  }

  // ─── Create Payment Order + QR ───────────────────────────


  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('create')
  @ApiOperation({
    summary: 'Create payment order with VietQR code',
    description: 'Generates a payment order and a VietQR transfer QR code image URL for bank scanning.',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Payment order created with VietQR metadata',
    type: PaymentOrderResponseDto,
  })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid plan tier or payment payload' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Missing or invalid authentication token' })
  async createPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePaymentDto,
  ) {
    const amountVnd =
      dto.amountVnd || (dto.billingCycle === 'ANNUAL' ? 14990000 : 1499000);
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
  @ApiOperation({
    summary: 'Check payment status (for polling)',
    description: 'Query status of a payment (PENDING, COMPLETED, EXPIRED, FAILED). Auto-expires pending payments after 15 minutes.',
  })
  @ApiParam({
    name: 'paymentId',
    description: 'Unique payment identifier (MongoDB ObjectId)',
    example: '66d9c84e1234567890abcdef',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Current status of the payment',
    type: PaymentStatusResponseDto,
  })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Missing or invalid authentication token' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Payment order not found' })
  async getPaymentStatus(@Param('paymentId') paymentId: string) {
    return this.paymentService.getPaymentStatus(paymentId);
  }

  // ─── Casso Webhook (Public) ──────────────────────────────

  @Post('/webhook/casso')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Casso bank webhook receiver',
    description: 'Webhook endpoint triggered by Casso.vn on incoming bank transfers to match reference codes and activate subscriptions.',
  })
  @ApiHeader({
    name: 'authorization',
    description: 'Casso API Key or Secure Token (Format: Apikey <KEY>)',
    required: false,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Webhook transaction results',
    type: CassoWebhookResponseDto,
  })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Invalid Casso webhook authorization header' })
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
