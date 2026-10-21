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

  static toInvoiceResponse(inv: any) {
    const amount = inv.amount ?? inv.amountVnd ?? inv.totalAmountVnd ?? 0;
    const currency = inv.currency || (inv.amountVnd ? 'VND' : 'USD');
    const items = inv.items || inv.lineItems || (inv.planName ? [
      {
        id: '1',
        description: inv.planName,
        quantity: 1,
        unitPrice: amount,
        total: amount,
      }
    ] : []);

    return {
      id: inv.id || inv._id?.toString(),
      invoiceNumber: inv.invoiceNumber || inv.invoice_number,
      contractId: inv.contractId,
      contractNumber: inv.contractNumber,
      planName: inv.planName,
      amount,
      amountVnd: inv.amountVnd ?? amount,
      currency,
      status: (inv.status || 'PENDING').toUpperCase(),
      date: inv.createdAt || inv.billingPeriodStart || new Date().toISOString(),
      issueDate: inv.billingPeriodStart || inv.createdAt || new Date().toISOString(),
      dueDate: inv.dueDate || inv.billingPeriodEnd,
      paidAt: inv.paidAt,
      paymentMethod: inv.paymentMethod,
      organizationId: inv.organizationId?.toString(),
      organizationName: inv.organizationName,
      customerName: inv.customerName,
      customerEmail: inv.customerEmail,
      items,
      subtotal: inv.subtotalVnd ?? inv.subtotal ?? (amount * 0.9),
      tax: inv.taxAmountVnd ?? inv.tax ?? (amount * 0.1),
      downloadUrl: `/api/v1/billing/invoices/${inv.id || inv._id}/receipt.pdf`,
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
