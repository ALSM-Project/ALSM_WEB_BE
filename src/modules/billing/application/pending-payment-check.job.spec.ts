jest.mock('@nestjs/schedule', () => ({
  Cron: () => () => {},
  CronExpression: {
    EVERY_HOUR: '0 0 * * * *',
  },
}));

import { PendingPaymentCheckJob } from './pending-payment-check.job';
import { InvoiceStatus, SubscriptionStatus } from '../domain/billing.types';
import { Types } from 'mongoose';

describe('PendingPaymentCheckJob (BR-120, BR-121, Non-Screen Function #42)', () => {
  let job: PendingPaymentCheckJob;
  let mockInvoiceModel: any;
  let mockSubscriptionModel: any;
  let mockAuditLogModel: any;
  let mockNotificationModel: any;
  let mockConnection: any;
  let mockContractsCol: any;
  let mockOrgsCol: any;

  beforeEach(() => {
    mockContractsCol = {
      updateMany: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    mockOrgsCol = {
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    mockConnection = {
      db: {
        collection: jest.fn((colName: string) => {
          if (colName === 'contracts') return mockContractsCol;
          if (colName === 'organizations') return mockOrgsCol;
          return { updateOne: jest.fn(), updateMany: jest.fn() };
        }),
      },
    };

    mockInvoiceModel = {
      find: jest.fn(),
    };

    mockSubscriptionModel = {
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };

    mockAuditLogModel = {
      create: jest.fn().mockResolvedValue({}),
    };

    mockNotificationModel = {
      create: jest.fn().mockResolvedValue({}),
    };

    job = new PendingPaymentCheckJob(
      mockInvoiceModel,
      mockSubscriptionModel,
      mockAuditLogModel,
      mockNotificationModel,
      mockConnection,
    );
  });

  it('should find expired pending invoices (> 7 days) and auto-cancel upgrade & linked resources', async () => {
    const expiredInvoice = {
      _id: new Types.ObjectId(),
      invoiceNumber: 'INV-2026-0001',
      status: InvoiceStatus.PENDING,
      amountVnd: 50000000,
      userId: new Types.ObjectId(),
      organizationId: new Types.ObjectId(),
      subscriptionId: new Types.ObjectId(),
      contractId: new Types.ObjectId(),
      contractNumber: 'CTR-2026-001',
      createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000), // 8 days ago
      save: jest.fn().mockResolvedValue(true),
    };

    mockInvoiceModel.find.mockResolvedValue([expiredInvoice]);

    const result = await job.checkPendingPaymentGracePeriod();

    expect(result.processedCount).toBe(1);
    expect(result.cancelledInvoices).toContain('INV-2026-0001');
    expect(expiredInvoice.status).toBe(InvoiceStatus.OVERDUE);
    expect(expiredInvoice.save).toHaveBeenCalled();

    // Verify subscription canceled
    expect(mockSubscriptionModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: expiredInvoice.subscriptionId }),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: SubscriptionStatus.CANCELLED,
        }),
      }),
    );

    // Verify contract canceled
    expect(mockContractsCol.updateMany).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'CANCELLED',
        }),
      }),
    );

    // Verify audit log created with 7-year retention
    expect(mockAuditLogModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'PAYMENT_GRACE_PERIOD_EXPIRED',
        resourceType: 'INVOICE',
        resourceId: expiredInvoice._id.toString(),
      }),
    );

    // Verify user notification created
    expect(mockNotificationModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: expiredInvoice.userId,
        type: 'PAYMENT_EXPIRED',
      }),
    );
  });

  it('should do nothing if no pending invoices have exceeded the 7-day grace period', async () => {
    mockInvoiceModel.find.mockResolvedValue([]);

    const result = await job.checkPendingPaymentGracePeriod();

    expect(result.processedCount).toBe(0);
    expect(mockSubscriptionModel.updateOne).not.toHaveBeenCalled();
    expect(mockContractsCol.updateMany).not.toHaveBeenCalled();
    expect(mockAuditLogModel.create).not.toHaveBeenCalled();
  });
});
