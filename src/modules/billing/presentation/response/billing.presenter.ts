import {
  InvoiceProps,
  QuoteRequestProps,
  SubscriptionProps,
} from '../../domain/billing.repository.interface';

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

  static toInvoiceDetailResponse(inv: any) {
    const subtotal = inv.amountVnd || 0;
    const taxRate = inv.taxRate ?? 0.1;
    const taxAmount = inv.taxAmountVnd ?? Math.round(subtotal * taxRate);
    const totalAmount = inv.totalAmountVnd ?? (subtotal + taxAmount);

    return {
      ...this.toInvoiceResponse(inv),
      organizationId: inv.organizationId,
      organizationName: inv.organizationName || 'ALSM Enterprise Client',
      userId: inv.userId,
      customerName: inv.customerName || 'Enterprise Customer',
      customerEmail: inv.customerEmail || 'enterprise@company.com',
      currency: 'VND',
      subtotalVnd: subtotal,
      taxRate,
      taxAmountVnd: taxAmount,
      totalAmountVnd: totalAmount,
      lineItems: inv.lineItems || [
        {
          description: `${inv.planName || 'Modernization'} (${inv.planTier || 'ENTERPRISE'}) License`,
          quantity: 1,
          unitPriceVnd: subtotal,
          amountVnd: subtotal,
        },
      ],
      paymentDetails: inv.paymentDetails,
      downloadUrl: `/api/v1/billing/invoices/${inv.id}/receipt.pdf`,
    };
  }

  static toQuoteRequestResponse(req: QuoteRequestProps) {
    return {
      id: req.id,
      status: req.status,
      statusReason: req.statusReason,
      appealMessage: req.appealMessage,
      appealStatus: req.appealStatus,
      appealResponse: req.appealResponse,
      appealedAt: req.appealedAt,
      appealResolvedAt: req.appealResolvedAt,
      fullName: req.fullName,
      companyName: req.companyName,
      email: req.email,
      phone: req.phone,
      message: req.message,
      currentPlanTier: req.currentPlanTier,
      createdAt: req.createdAt,
    };
  }
}
