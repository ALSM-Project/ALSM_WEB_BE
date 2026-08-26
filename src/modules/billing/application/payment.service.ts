import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  BillingCycle,
  PLAN_CATALOGUE,
  PaymentStatus,
  PlanTier,
} from '../domain/billing.types';
import { Payment, PaymentDocument } from '../infrastructure/payment.schema';
import { BillingService } from './billing.service';
import { CassoTransaction } from '../presentation/billing.dto';

/** Bank account info for VietQR – configure per environment. */
const BANK_CONFIG = {
  bankId: 'MB',             // MB Bank code for VietQR
  bankName: 'MB Bank',
  accountNumber: '005220248888',
  accountName: 'MODERNIZER JSC',
};

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);
  private readonly cassoApiKey: string;

  constructor(
    @InjectModel(Payment.name) private readonly paymentModel: Model<PaymentDocument>,
    private readonly billingService: BillingService,
    private readonly config: ConfigService,
  ) {
    this.cassoApiKey = this.config.get<string>('CASSO_API_KEY', '');
  }

  // ─── Create Payment Order ────────────────────────────────

  async createPaymentOrder(
    userId: string,
    organizationId: string,
    planTier: PlanTier,
    billingCycle: BillingCycle,
  ) {
    const plan = PLAN_CATALOGUE.find((p) => p.tier === planTier);
    if (!plan) throw new BadRequestException('Invalid plan tier');
    if (plan.tier === PlanTier.ENTERPRISE) {
      throw new BadRequestException('Enterprise plans require contacting sales.');
    }

    const amountVnd =
      billingCycle === BillingCycle.ANNUAL ? plan.annualPriceVnd * 12 : plan.monthlyPriceVnd;

    // Generate a unique reference code: ALSM + random 6 digits
    const refNum = String(Math.floor(100000 + Math.random() * 900000));
    const referenceCode = `ALSM${refNum}`;

    // QR code expires in 15 minutes
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    // Generate VietQR URL
    // Format: https://img.vietqr.io/image/{bankId}-{accountNumber}-qr_only.png?amount={amount}&addInfo={referenceCode}
    const qrDataUrl = `https://img.vietqr.io/image/${BANK_CONFIG.bankId}-${BANK_CONFIG.accountNumber}-compact2.png?amount=${amountVnd}&addInfo=${encodeURIComponent(referenceCode)}&accountName=${encodeURIComponent(BANK_CONFIG.accountName)}`;

    // Create subscription in PENDING_PAYMENT state
    const subscription = await this.billingService.createPaidSubscription(
      userId,
      organizationId,
      planTier,
      billingCycle,
    );

    // Create the payment record
    const payment = await this.paymentModel.create({
      userId: new Types.ObjectId(userId),
      organizationId: new Types.ObjectId(organizationId),
      subscriptionId: new Types.ObjectId(subscription.id),
      planTier,
      amountVnd,
      status: PaymentStatus.PENDING,
      referenceCode,
      qrDataUrl,
      bankName: BANK_CONFIG.bankName,
      accountNumber: BANK_CONFIG.accountNumber,
      accountName: BANK_CONFIG.accountName,
      expiresAt,
    });

    // Create invoice
    const periodEnd = new Date();
    if (billingCycle === BillingCycle.ANNUAL) {
      periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    } else {
      periodEnd.setMonth(periodEnd.getMonth() + 1);
    }

    const invoice = await this.billingService.createInvoice(
      userId,
      organizationId,
      subscription.id,
      planTier,
      plan.name,
      amountVnd,
      new Date(),
      periodEnd,
    );

    this.logger.log(`Payment order created: ${referenceCode}, amount=${amountVnd} VND`);

    return {
      paymentId: payment._id.toString(),
      subscriptionId: subscription.id,
      invoiceNumber: invoice.invoiceNumber,
      planName: `${plan.name} (${billingCycle === BillingCycle.MONTHLY ? 'Monthly' : 'Annual'})`,
      amountVnd,
      currency: '₫',
      referenceCode,
      qrDataUrl,
      bankName: BANK_CONFIG.bankName,
      accountNumber: BANK_CONFIG.accountNumber,
      accountName: BANK_CONFIG.accountName,
      expiresAt,
    };
  }

  // ─── Check Payment Status ────────────────────────────────

  async getPaymentStatus(paymentId: string) {
    const payment = await this.paymentModel.findById(paymentId).lean();
    if (!payment) throw new NotFoundException('Payment not found');

    // Check if expired
    if (payment.status === PaymentStatus.PENDING && new Date() > payment.expiresAt) {
      await this.paymentModel.updateOne(
        { _id: payment._id },
        { status: PaymentStatus.EXPIRED },
      );
      return { status: PaymentStatus.EXPIRED };
    }

    return {
      status: payment.status,
      paidAt: payment.paidAt,
      amountVnd: payment.amountVnd,
    };
  }

  // ─── Casso Webhook Handler ───────────────────────────────

  /**
   * Process incoming Casso webhook.
   * Casso sends bank transactions when money arrives.
   * We match the transaction description against our referenceCode.
   */
  async handleCassoWebhook(transactions: CassoTransaction[]) {
    let matchedCount = 0;

    for (const tx of transactions) {
      this.logger.log(`Casso TX: id=${tx.id}, amount=${tx.amount}, desc="${tx.description}"`);

      // Extract potential reference codes from the description
      // Casso description typically contains the transfer note that the user wrote
      const description = (tx.description || '').toUpperCase();

      // Find matching pending payment by reference code
      const pendingPayments = await this.paymentModel.find({
        status: PaymentStatus.PENDING,
        expiresAt: { $gt: new Date() },
      });

      for (const payment of pendingPayments) {
        const refUpper = payment.referenceCode.toUpperCase();

        // Check if the description contains our reference code
        // and the amount matches (or is greater/equal)
        if (description.includes(refUpper) && tx.amount >= payment.amountVnd) {
          // Mark payment as completed
          payment.status = PaymentStatus.COMPLETED;
          payment.paidAt = new Date();
          payment.cassoTransactionId = String(tx.id);
          await payment.save();

          // Activate the subscription
          if (payment.subscriptionId) {
            await this.billingService.activateSubscription(payment.subscriptionId.toString());
          }

          // Mark invoice as paid
          if (payment.invoiceId) {
            await this.billingService.markInvoicePaid(
              payment.invoiceId.toString(),
              'QR Bank Transfer',
            );
          }

          this.logger.log(`✅ Payment matched! Ref=${payment.referenceCode}, TxID=${tx.id}`);
          matchedCount++;
          break;
        }
      }
    }

    this.logger.log(`Casso webhook processed: ${transactions.length} TX, ${matchedCount} matched`);
    return { processed: transactions.length, matched: matchedCount };
  }

  /**
   * Validate the Casso webhook request.
   * Casso sends an API key in the Authorization header.
   */
  validateCassoWebhook(authHeader: string | undefined): boolean {
    if (!this.cassoApiKey) {
      this.logger.warn('CASSO_API_KEY not configured – skipping webhook validation');
      return true; // Allow in dev if not configured
    }
    // Casso sends: "Apikey <key>"
    const token = authHeader?.replace(/^Apikey\s+/i, '').trim();
    return token === this.cassoApiKey;
  }
}
