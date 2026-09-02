import { InvoiceProps, SubscriptionProps } from '../../domain/billing.repository.interface';

export class BillingPresenter {
  static toSubscriptionResponse(sub: SubscriptionProps | null) {
    if (!sub) return null;

    return {
      id: sub.id,
      planTier: sub.planTier,
      planName: sub.planName,
      status: sub.status,
      billingCycle: sub.billingCycle,
      amountVnd: sub.amountVnd,
      trialEndsAt: sub.trialEndsAt,
      currentPeriodStart: sub.currentPeriodStart,
      currentPeriodEnd: sub.currentPeriodEnd,
      cancelledAt: sub.cancelledAt,
      createdAt: sub.createdAt,
    };
  }

  static toInvoiceResponse(inv: InvoiceProps) {
    return {
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      planName: inv.planName,
      amountVnd: inv.amountVnd,
      status: inv.status,
      billingPeriodStart: inv.billingPeriodStart,
      billingPeriodEnd: inv.billingPeriodEnd,
      paidAt: inv.paidAt,
      paymentMethod: inv.paymentMethod,
      createdAt: inv.createdAt,
    };
  }

  static toInvoiceListResponse(invoices: InvoiceProps[]) {
    return invoices.map((inv) => this.toInvoiceResponse(inv));
  }
}
