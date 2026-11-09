import {
  InvoiceProps,
  PaymentProps,
  QuoteRequestProps,
  SubscriptionProps,
} from '../../domain/billing.repository.interface';
import { SubscriptionDocument } from '../subscription.schema';
import { InvoiceDocument } from '../invoice.schema';
import { PaymentDocument } from '../payment.schema';
import { QuoteRequestDocument } from '../quote-request.schema';

export class SubscriptionMapper {
  static toDomain(doc: SubscriptionDocument): SubscriptionProps {
    const raw = doc as unknown as { createdAt?: Date; updatedAt?: Date; appealedAt?: Date; appealResolvedAt?: Date };
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
      suspensionReason: doc.suspensionReason,
      suspendedAt: doc.suspendedAt,
      suspendedBy: doc.suspendedBy?.toString(),
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    };
  }
}

export class InvoiceMapper {
  static toDomain(doc: any): InvoiceProps {
    const raw = doc as any;
    return {
      id: raw._id?.toString() || raw.id || '',
      userId: raw.userId?.toString() || '',
      organizationId: raw.organizationId?.toString() || '',
      subscriptionId: raw.subscriptionId?.toString(),
      contractId: raw.contractId?.toString(),
      contractNumber: raw.contractNumber,
      invoiceNumber: raw.invoiceNumber || raw.invoice_number || '',
      planTier: raw.planTier || ('ENTERPRISE' as any),
      planName: raw.planName || (raw.contractNumber ? `Hợp đồng ${raw.contractNumber}` : 'Enterprise Modernization Plan'),
      subtotalVnd: raw.subtotalVnd ?? raw.subtotal ?? (raw.amount ? Math.round(raw.amount / 1.1) : 0),
      vatRate: raw.vatRate ?? 10,
      taxAmountVnd: raw.taxAmountVnd ?? raw.taxAmount ?? (raw.amount ? Math.round(raw.amount - raw.amount / 1.1) : 0),
      amountVnd: raw.amountVnd ?? raw.amount ?? 0,
      currency: raw.currency || 'VND',
      status: raw.status || ('ISSUED' as any),
      billingPeriodStart: raw.billingPeriodStart || raw.createdAt || new Date(),
      billingPeriodEnd: raw.billingPeriodEnd || raw.dueDate || new Date(),
      dueDate: raw.dueDate || raw.dueAt,
      paidAt: raw.paidAt,
      paymentMethod: raw.paymentMethod || 'VIETQR_BANK_TRANSFER',
      cassoTransactionId: raw.cassoTransactionId || raw.transactionRef,
      items: raw.items || [],
      createdAt: raw.createdAt || new Date(),
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

export class QuoteRequestMapper {
  static toDomain(doc: QuoteRequestDocument): QuoteRequestProps {
    const raw = doc as unknown as { createdAt?: Date; updatedAt?: Date; appealedAt?: Date; appealResolvedAt?: Date };
    return {
      id: doc._id.toString(),
      userId: doc.userId.toString(),
      organizationId: doc.organizationId.toString(),
      fullName: doc.fullName,
      companyName: doc.companyName,
      email: doc.email,
      phone: doc.phone,
      message: doc.message,
      currentPlanTier: doc.currentPlanTier,
      status: doc.status,
      statusReason: doc.statusReason,
      appealMessage: doc.appealMessage,
      appealStatus: doc.appealStatus,
      appealResponse: doc.appealResponse,
      appealedAt: raw.appealedAt,
      appealResolvedAt: raw.appealResolvedAt,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    };
  }
}
