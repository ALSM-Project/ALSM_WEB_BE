import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CassoTransaction,
  PaymentStatus,
  PlanTier,
  VIETQR_BANK_CONFIG,
} from '../domain/billing.types';
import { BillingService } from './billing.service';
import {
  IPaymentRepository,
  PAYMENT_REPOSITORY,
} from '../domain/billing.repository.interface';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    @Inject(PAYMENT_REPOSITORY)
    private readonly paymentRepo: IPaymentRepository,
    private readonly billingService: BillingService,
    private readonly configService: ConfigService,
  ) {}

  // ─── Casso Webhook Validation ─────────────────────────────

  validateCassoWebhook(authHeader?: string): boolean {
    const expectedKey = this.configService.get<string>('CASSO_API_KEY');
    if (!expectedKey) return true; // dev mode default
    if (!authHeader) return false;
    const token = authHeader.replace(/^Apikey\s+/i, '').trim();
    return token === expectedKey;
  }

  // ─── VietQR Payment Order Creation ────────────────────────

  async createQRPayment(
    userId: string,
    organizationId: string,
    planTier: PlanTier,
    amountVnd: number,
    subscriptionId?: string,
    invoiceId?: string,
  ) {
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const referenceCode = `ALSM${randomSuffix}`;

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins expiry

    const bank = VIETQR_BANK_CONFIG;
    const addInfo = encodeURIComponent(referenceCode);
    const accountName = encodeURIComponent(bank.accountName);
    const qrDataUrl = `https://img.vietqr.io/image/${bank.bankId}-${bank.accountNumber}-compact2.png?amount=${amountVnd}&addInfo=${addInfo}&accountName=${accountName}`;

    const payment = await this.paymentRepo.create({
      userId,
      organizationId,
      subscriptionId,
      invoiceId,
      planTier,
      amountVnd,
      status: PaymentStatus.PENDING,
      referenceCode,
      qrDataUrl,
      bankName: bank.bankName,
      accountNumber: bank.accountNumber,
      accountName: bank.accountName,
      expiresAt,
    });

    this.logger.log(`Created QR Payment ${payment.id}, Ref=${referenceCode}, Amount=${amountVnd} VND`);

    return {
      paymentId: payment.id,
      subscriptionId: payment.subscriptionId,
      invoiceNumber: payment.invoiceId || 'INV-PENDING',
      planName: planTier,
      amountVnd: payment.amountVnd,
      currency: 'VND',
      referenceCode: payment.referenceCode,
      qrDataUrl: payment.qrDataUrl,
      bankName: payment.bankName,
      accountNumber: payment.accountNumber,
      accountName: payment.accountName,
      expiresAt: payment.expiresAt.toISOString(),
    };
  }

  // ─── Check Payment Status (Polling Endpoint) ──────────────

  async getPaymentStatus(paymentId: string) {
    const payment = await this.paymentRepo.findById(paymentId);
    if (!payment) throw new NotFoundException('Payment not found');

    if (payment.status === PaymentStatus.PENDING && new Date() > payment.expiresAt) {
      await this.paymentRepo.updateStatus(paymentId, PaymentStatus.EXPIRED);
      return { status: PaymentStatus.EXPIRED, paidAt: null, amountVnd: payment.amountVnd };
    }

    return {
      status: payment.status,
      paidAt: payment.paidAt,
      amountVnd: payment.amountVnd,
    };
  }

  // ─── Casso Webhook Handler ───────────────────────────────

  async handleCassoWebhook(transactions: CassoTransaction[]) {
    let matchedCount = 0;

    for (const tx of transactions) {
      this.logger.log(`Casso TX: id=${tx.id}, amount=${tx.amount}, desc="${tx.description}"`);

      const description = (tx.description || '').toUpperCase();
      const normalizedDesc = description.replace(/[^A-Z0-9]/g, '');

      const pendingPayments = await this.paymentRepo.findPending();

      for (const payment of pendingPayments) {
        const refUpper = payment.referenceCode.toUpperCase();
        const refClean = refUpper.replace(/[^A-Z0-9]/g, '');

        const isMatched = description.includes(refUpper) || normalizedDesc.includes(refClean);

        if (isMatched && tx.amount >= payment.amountVnd) {
          await this.paymentRepo.updateStatus(
            payment.id,
            PaymentStatus.COMPLETED,
            new Date(),
            String(tx.id),
          );

          if (payment.subscriptionId) {
            await this.billingService.activateSubscription(payment.subscriptionId);
          }

          if (payment.invoiceId) {
            await this.billingService.markInvoicePaid(
              payment.invoiceId,
              'QR Bank Transfer',
            );
          }

          this.logger.log(`✅ Payment matched! Ref=${payment.referenceCode}, TxID=${tx.id}`);
          matchedCount++;
          break;
        } else if (isMatched && tx.amount < payment.amountVnd) {
          this.logger.warn(`⚠️ Partial payment detected! Ref=${payment.referenceCode}, Required=${payment.amountVnd}, Received=${tx.amount}`);
        }
      }
    }

    this.logger.log(`Casso webhook processed: ${transactions.length} TX, ${matchedCount} matched`);
    return { processed: transactions.length, matched: matchedCount };
  }
}
