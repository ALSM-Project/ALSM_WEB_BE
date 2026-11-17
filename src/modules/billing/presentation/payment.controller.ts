import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Req,
  Post,
  Put,
  UnauthorizedException,
  UseGuards,
  UsePipes,
  ValidationPipe,
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
  CassoTransaction,
  CassoWebhookPayload,
  CassoWebhookResponseDto,
  CreatePaymentDto,
  PaymentOrderResponseDto,
  PaymentStatusResponseDto,
} from './billing.dto';

@ApiTags('Billing - Payments')
@Controller(['billing/payment', ''])
export class PaymentController {
  private readonly logger = new Logger(PaymentController.name);

  constructor(private readonly paymentService: PaymentService) {}

  @Get('bank-config')
  @ApiOperation({
    summary: 'Get active payment bank configuration',
    description:
      'Retrieves the active bank account details used for QR code generation from MongoDB.',
  })
  async getBankConfig() {
    return this.paymentService.getBankConfig();
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Put('bank-config')
  @ApiOperation({
    summary: 'Update active payment bank configuration',
    description: 'Updates active company receiving bank account and QR details in MongoDB.',
  })
  async updateBankConfig(@Body() body: any) {
    return this.paymentService.updateBankConfig(body);
  }

  // ─── Create Payment Order + QR ───────────────────────────

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('create')
  @ApiOperation({
    summary: 'Create payment order with bank transfer QR code',
    description:
      'Generates a payment order and a bank transfer QR code image URL for scanning.',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Payment order created with QR metadata',
    type: PaymentOrderResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid plan tier or payment payload',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid authentication token',
  })
  async createPayment(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePaymentDto) {
    const amountVnd = dto.amountVnd || (dto.billingCycle === 'ANNUAL' ? 14990000 : 1499000);
    return this.paymentService.createQRPayment(
      user.userId,
      (user as AuthenticatedUser & { organizationId?: string }).organizationId || user.userId,
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
    description:
      'Query status of a payment (PENDING, COMPLETED, EXPIRED, FAILED). Auto-expires pending payments after 15 minutes.',
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
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid authentication token',
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Payment order not found' })
  async getPaymentStatus(@Param('paymentId') paymentId: string) {
    return this.paymentService.getPaymentStatus(paymentId);
  }

  // ─── Casso Webhook (Public) ──────────────────────────────

  @Post('/webhook/casso')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ whitelist: false, forbidNonWhitelisted: false, transform: true }))
  @ApiOperation({
    summary: 'Casso bank webhook receiver',
    description:
      'Webhook endpoint triggered by Casso.vn on incoming bank transfers to match reference codes and activate subscriptions.',
  })
  @ApiHeader({
    name: 'secure-token',
    description: 'Casso Webhook V2 Secure Token',
    required: false,
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
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Invalid Casso webhook authorization header',
  })
  async handleCassoWebhook(
    @Headers() headers: Record<string, string>,
    @Req() req: any,
    @Body() payload: CassoWebhookPayload,
  ) {
    this.logger.log('Received Casso webhook');

    const authHeader = headers['authorization'];
    const secureToken =
      headers['secure-token'] || headers['secure_token'] || headers['x-casso-signature'];

    const rawData = payload.data;
    let transactions: CassoTransaction[] = [];
    if (Array.isArray(rawData)) {
      transactions = rawData;
    } else if (rawData && typeof rawData === 'object') {
      transactions = [rawData as CassoTransaction];
    }

    const isTestCall = transactions.some(
      (tx) => tx.id === 0 || (tx.description && tx.description.toLowerCase().includes('thu nghiem')),
    );

    // Validate the webhook auth (supports secure-token header, authorization header, and test call passthrough)
    const isValid = this.paymentService.validateCassoWebhook(authHeader, secureToken, isTestCall);
    if (!isValid) {
      this.logger.warn(
        `Invalid Casso webhook authorization. Received secure-token: ${secureToken ? secureToken.substring(0, 10) + '...' : 'none'}, authorization: ${authHeader ? authHeader.substring(0, 10) + '...' : 'none'}`,
      );
      throw new UnauthorizedException('Invalid webhook authorization');
    }

    if (payload.error && payload.error !== 0) {
      this.logger.warn(`Casso webhook error: ${payload.error}`);
      return { success: false, error: 'Casso reported an error' };
    }

    if (transactions.length === 0) {
      return { success: true, message: 'No transactions to process' };
    }

    const clientIp = (req?.headers['x-forwarded-for'] || req?.socket?.remoteAddress || '127.0.0.1') as string;
    const result = await this.paymentService.handleCassoWebhook(transactions, clientIp, headers);
    return { success: true, ...result };
  }

  @Get('/webhook/casso/logs')
  @ApiOperation({ summary: 'Get recent Casso webhook audit logs' })
  async getCassoWebhookLogs() {
    return this.paymentService.getWebhookLogs();
  }

  @Post('/webhook/casso/test-simulate')
  @ApiOperation({ summary: 'Manually simulate an incoming Casso webhook transaction for testing' })
  async simulateCassoWebhook(
    @Body() body: { referenceCode: string; amount?: number; description?: string },
  ) {
    const amount = body.amount || 12100;
    const desc = body.description || `ALSM ${body.referenceCode}`;
    const tx = {
      id: Math.floor(100000 + Math.random() * 900000),
      amount,
      description: desc,
    } as any;
    return this.paymentService.handleCassoWebhook([tx], 'MANUAL_SIMULATION');
  }
}
