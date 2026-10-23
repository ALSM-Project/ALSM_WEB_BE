/**
 * Pure TypeScript PDF 1.4 generator for ALSM invoices and receipts.
 * Generates standards-compliant, dependency-free binary PDF documents.
 */

export interface InvoicePdfData {
  invoiceNumber: string;
  planName: string;
  planTier: string;
  amountVnd: number;
  status: string;
  billingPeriodStart: Date | string;
  billingPeriodEnd: Date | string;
  paidAt?: Date | string | null;
  paymentMethod?: string | null;
  organizationName?: string;
  customerName?: string;
  customerEmail?: string;
}

export function generateInvoicePdfBuffer(data: InvoicePdfData): Buffer {
  const sanitize = (val?: string | null) => (val || '').replace(/[()\\]/g, '');
  const formatMoney = (amount: number) =>
    new Intl.NumberFormat('vi-VN').format(amount) + ' VND';

  const formatDate = (date?: Date | string | null) => {
    if (!date) return 'N/A';
    try {
      const d = typeof date === 'string' ? new Date(date) : date;
      return d.toISOString().split('T')[0];
    } catch {
      return String(date);
    }
  };

  const orgName = sanitize(data.organizationName || 'ALSM Enterprise Client');
  const custName = sanitize(data.customerName || 'Enterprise Administrator');
  const custEmail = sanitize(data.customerEmail || 'enterprise@company.com');
  const invNumber = sanitize(data.invoiceNumber);
  const planName = sanitize(data.planName);
  const planTier = sanitize(data.planTier);
  const status = sanitize(data.status).toUpperCase();
  const period = `${formatDate(data.billingPeriodStart)} to ${formatDate(data.billingPeriodEnd)}`;
  const payMethod = sanitize(data.paymentMethod || 'Bank Wire / QR VietQR');
  const subtotal = data.amountVnd;
  const vat = Math.round(subtotal * 0.1);
  const total = subtotal + vat;

  // Build PDF stream commands
  const ops: string[] = [];

  // Title / Brand Header
  ops.push('BT /F1 18 Tf 50 800 Td (ALSM SOFTWARE - ENTERPRISE MODERNIZATION) Tj ET');
  ops.push('BT /F1 10 Tf 50 782 Td (Application Legacy Screen Modernization Platform | https://alsm.io) Tj ET');

  // Separator Line
  ops.push('0.2 w 50 770 m 545 770 l S');

  // Invoice Title & Status
  ops.push('BT /F1 16 Tf 50 740 Td (OFFICIAL INVOICE & RECEIPT) Tj ET');
  ops.push(`BT /F1 11 Tf 400 740 Td (Status: [ ${status} ]) Tj ET`);

  // Invoice Details
  ops.push(`BT /F1 10 Tf 50 715 Td (Invoice Number:  ${invNumber}) Tj ET`);
  ops.push(`BT /F1 10 Tf 50 700 Td (Date of Issue:   ${formatDate(data.billingPeriodStart)}) Tj ET`);
  ops.push(`BT /F1 10 Tf 50 685 Td (Billing Period:  ${period}) Tj ET`);
  ops.push(`BT /F1 10 Tf 400 715 Td (Payment Method: ${payMethod}) Tj ET`);
  if (data.paidAt) {
    ops.push(`BT /F1 10 Tf 400 700 Td (Paid On:        ${formatDate(data.paidAt)}) Tj ET`);
  }

  // Customer / Organization Box
  ops.push('0.5 w 50 665 m 545 665 l S');
  ops.push('BT /F1 11 Tf 50 645 Td (BILL TO:) Tj ET');
  ops.push(`BT /F1 10 Tf 50 630 Td (Organisation: ${orgName}) Tj ET`);
  ops.push(`BT /F1 10 Tf 50 615 Td (Attention:    ${custName} <${custEmail}>) Tj ET`);
  ops.push('0.5 w 50 600 m 545 600 l S');

  // Line items header
  ops.push('BT /F1 10 Tf 55 585 Td (NO) Tj ET');
  ops.push('BT /F1 10 Tf 90 585 Td (DESCRIPTION / SERVICE) Tj ET');
  ops.push('BT /F1 10 Tf 350 585 Td (QTY) Tj ET');
  ops.push('BT /F1 10 Tf 440 585 Td (AMOUNT (VND)) Tj ET');
  ops.push('0.2 w 50 575 m 545 575 l S');

  // Item row 1
  ops.push('BT /F1 10 Tf 55 555 Td (1) Tj ET');
  ops.push(`BT /F1 10 Tf 90 555 Td (${planName} (${planTier}) Modernization License) Tj ET`);
  ops.push('BT /F1 10 Tf 350 555 Td (1) Tj ET');
  ops.push(`BT /F1 10 Tf 440 555 Td (${formatMoney(subtotal)}) Tj ET`);

  ops.push('0.2 w 50 535 m 545 535 l S');

  // Summary Totals
  ops.push(`BT /F1 10 Tf 330 515 Td (Subtotal:) Tj ET`);
  ops.push(`BT /F1 10 Tf 440 515 Td (${formatMoney(subtotal)}) Tj ET`);

  ops.push(`BT /F1 10 Tf 330 495 Td (VAT (10%):) Tj ET`);
  ops.push(`BT /F1 10 Tf 440 495 Td (${formatMoney(vat)}) Tj ET`);

  ops.push('0.5 w 330 485 m 545 485 l S');
  ops.push(`BT /F1 12 Tf 330 465 Td (TOTAL DUE:) Tj ET`);
  ops.push(`BT /F1 12 Tf 440 465 Td (${formatMoney(total)}) Tj ET`);

  // Banking instructions if pending or reference
  ops.push('0.2 w 50 435 m 545 435 l S');
  ops.push('BT /F1 10 Tf 50 415 Td (BANKING & PAYMENT REFERENCE DETAILS:) Tj ET');
  ops.push('BT /F1 9 Tf 50 398 Td (Beneficiary Bank:  MB Bank (Military Commercial Joint Stock Bank)) Tj ET');
  ops.push('BT /F1 9 Tf 50 383 Td (Account Number:    090123456789) Tj ET');
  ops.push('BT /F1 9 Tf 50 368 Td (Account Name:      CONG TY CO PHAN ALSM SOFTWARE) Tj ET');
  ops.push(`BT /F1 9 Tf 50 353 Td (Payment Reference: ALSM${invNumber.replace(/\\D/g, '') || 'INV'}) Tj ET`);

  // Footer Note
  ops.push('0.2 w 50 200 m 545 200 l S');
  ops.push('BT /F1 8 Tf 50 185 Td (This electronic invoice is generated automatically by ALSM Enterprise Modernization Platform.) Tj ET');
  ops.push('BT /F1 8 Tf 50 170 Td (For support or enterprise queries, contact billing@alsm.io or support@alsm.io) Tj ET');

  const contentStream = ops.join('\n');
  const streamLen = Buffer.byteLength(contentStream);

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];

  function addObj(str: string) {
    offsets.push(Buffer.byteLength(body));
    body += str + '\n';
  }

  addObj('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj');
  addObj('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj');
  addObj('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj');
  addObj('4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj');
  addObj(`5 0 obj\n<< /Length ${streamLen} >>\nstream\n${contentStream}\nendstream\nendobj`);

  const xrefOffset = Buffer.byteLength(body);
  let xref = 'xref\n0 6\n0000000000 65535 f \n';
  for (const off of offsets) {
    xref += String(off).padStart(10, '0') + ' 00000 n \n';
  }
  body += xref;
  body += 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xrefOffset + '\n%%EOF';

  return Buffer.from(body);
}
