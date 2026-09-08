import {
  InvoiceProps,
  PaymentProps,
  SubscriptionProps,
} from '../../domain/billing.repository.interface';
import { SubscriptionDocument } from '../subscription.schema';
import { InvoiceDocument } from '../invoice.schema';
import { PaymentDocument } from '../payment.schema';

export class SubscriptionMapper {
  static toDomain(doc: SubscriptionDocument): SubscriptionProps {
    const raw = doc as unknown as { createdAt?: Date; updatedAt?: Date };
    return {
      id: doc._id.toString(),
      userId: doc.userId.toString(),
      organizationId: doc.organizationId.toString(),
      planTier: doc.planTier,
      planName: doc.planName,
      billingCycle: doc.billingCycle,
      status: doc.status,
      amountVnd: doc.amountVnd,
      trialEndsAt: doc.trialEndsAt,
      currentPeriodStart: doc.currentPeriodStart,
      currentPeriodEnd: doc.currentPeriodEnd,
      cancelledAt: doc.cancelledAt,
      cancelReason: doc.cancelReason,
      cancelFeedback: doc.cancelFeedback,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    };
  }
}

export class InvoiceMapper {
  static toDomain(doc: InvoiceDocument): InvoiceProps {
    const raw = doc as unknown as { createdAt?: Date };
    return {
      id: doc._id.toString(),
      userId: doc.userId.toString(),
      organizationId: doc.organizationId.toString(),
      subscriptionId: doc.subscriptionId?.toString(),
      invoiceNumber: doc.invoiceNumber,
      planTier: doc.planTier,
      planName: doc.planName,
      amountVnd: doc.amountVnd,
      status: doc.status,
      billingPeriodStart: doc.billingPeriodStart,
      billingPeriodEnd: doc.billingPeriodEnd,
      paidAt: doc.paidAt,
      paymentMethod: doc.paymentMethod,
      createdAt: raw.createdAt,
    };
  }
}

export class PaymentMapper {
  static toDomain(doc: PaymentDocument): PaymentProps {
    const raw = doc as unknown as { createdAt?: Date };
    return {
      id: doc._id.toString(),
      userId: doc.userId.toString(),
      organizationId: doc.organizationId.toString(),
      subscriptionId: doc.subscriptionId?.toString(),
      invoiceId: doc.invoiceId?.toString(),
      planTier: doc.planTier,
      amountVnd: doc.amountVnd,
      status: doc.status,
      referenceCode: doc.referenceCode,
      qrDataUrl: doc.qrDataUrl || '',
      bankName: doc.bankName,
      accountNumber: doc.accountNumber,
      accountName: doc.accountName || '',
      expiresAt: doc.expiresAt,
      paidAt: doc.paidAt,
      cassoTransactionId: doc.cassoTransactionId,
      createdAt: raw.createdAt,
    };
  }
}
