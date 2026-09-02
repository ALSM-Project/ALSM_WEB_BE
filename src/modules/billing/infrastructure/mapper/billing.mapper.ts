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
      createdAt: (doc as any).createdAt,
      updatedAt: (doc as any).updatedAt,
    };
  }
}

export class InvoiceMapper {
  static toDomain(doc: InvoiceDocument): InvoiceProps {
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
      createdAt: (doc as any).createdAt,
    };
  }
}

export class PaymentMapper {
  static toDomain(doc: PaymentDocument): PaymentProps {
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
      createdAt: (doc as any).createdAt,
    };
  }
}
