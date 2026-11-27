import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Model, Connection, Types } from 'mongoose';
import { Invoice, InvoiceDocument } from '../infrastructure/invoice.schema';
import { Subscription, SubscriptionDocument } from '../infrastructure/subscription.schema';
import { InvoiceStatus, SubscriptionStatus } from '../domain/billing.types';
import { AuditLog, AuditLogDocument } from '../../audit/infrastructure/audit-log.schema';
import { SystemNotification, NotificationDocument } from '../../notifications/notification.schema';

/**
 * Background Processing & Scheduled Job:
 * Non-Screen Function #42: Pending Payment Check Service
 * Business Rules BR-120 & BR-121:
 * - BR-120: The grace period for payment is 7 days after invoice generation.
 * - BR-121: If unpaid after 7 days, the Web 3 upgrade is automatically canceled.
 */
@Injectable()
export class PendingPaymentCheckJob {
  private readonly logger = new Logger(PendingPaymentCheckJob.name);
  private isProcessing = false;

  constructor(
    @InjectModel(Invoice.name)
    private readonly invoiceModel: Model<InvoiceDocument>,
    @InjectModel(Subscription.name)
    private readonly subscriptionModel: Model<SubscriptionDocument>,
    @InjectModel(AuditLog.name)
    private readonly auditLogModel: Model<AuditLogDocument>,
    @InjectModel(SystemNotification.name)
    private readonly notificationModel: Model<NotificationDocument>,
    @InjectConnection()
    private readonly connection: Connection,
  ) {}

  /**
   * Run every hour to check for pending invoices that have exceeded the 7-day grace period.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async handleCron(): Promise<void> {
    await this.checkPendingPaymentGracePeriod();
  }

  /**
   * Main reconciliation logic for BR-120 and BR-121.
   * Can be invoked manually via endpoint or tests.
   */
  async checkPendingPaymentGracePeriod(): Promise<{
    processedCount: number;
    cancelledInvoices: string[];
    errors: string[];
  }> {
    if (this.isProcessing) {
      this.logger.warn('PendingPaymentCheckJob is already running. Skipping cycle.');
      return { processedCount: 0, cancelledInvoices: [], errors: ['Job already running'] };
    }

    this.isProcessing = true;
    const cancelledInvoices: string[] = [];
    const errors: string[] = [];

    try {
      // 7-day grace period: cutoff is 7 days ago
      const gracePeriodMs = 7 * 24 * 60 * 60 * 1000;
      const cutoffDate = new Date(Date.now() - gracePeriodMs);

      this.logger.log(
        `[PendingPaymentCheckJob] Starting payment grace period check. Cutoff: ${cutoffDate.toISOString()} (BR-120/121)`,
      );

      // Find all pending invoices created on or before cutoff date
      const expiredInvoices = await this.invoiceModel.find({
        status: { $in: [InvoiceStatus.PENDING, InvoiceStatus.ISSUED] },
        createdAt: { $lte: cutoffDate },
      });

      this.logger.log(`[PendingPaymentCheckJob] Found ${expiredInvoices.length} invoices exceeding 7-day grace period.`);

      for (const inv of expiredInvoices) {
        try {
          const invIdStr = inv._id.toString();
          const invoiceNum = inv.invoiceNumber || `INV-${invIdStr}`;

          // 1. Update Invoice Status to OVERDUE without full-document validation so legacy/incomplete records still transition cleanly
          inv.status = InvoiceStatus.OVERDUE;
          await inv.save({ validateBeforeSave: false });

          // 2. Cancel Subscription if in PENDING_PAYMENT
          if (inv.subscriptionId) {
            await this.subscriptionModel.updateOne(
              { _id: inv.subscriptionId, status: SubscriptionStatus.PENDING_PAYMENT },
              {
                $set: {
                  status: SubscriptionStatus.CANCELLED,
                  cancelledAt: new Date(),
                  cancellationReason: 'Payment grace period expired (7 days) without settlement (BR-120, BR-121)',
                },
              },
            );
          }

          // 3. Cancel linked Contract in contracts collection if awaiting payment
          if (this.connection.db) {
            const contractsCol = this.connection.db.collection('contracts');
            const contractFilter: any = {
              $or: [
                ...(inv.contractId ? [{ _id: inv.contractId }] : []),
                ...(inv.contractNumber ? [{ contractNumber: inv.contractNumber }] : []),
              ],
              status: { $in: ['Signed', 'Pending Payment', 'Payment Verification', 'PENDING_PAYMENT'] },
            };

            await contractsCol.updateMany(contractFilter, {
              $set: {
                status: 'CANCELLED',
                cancelledAt: new Date(),
                cancellationReason:
                  'Web 3 upgrade automatically canceled: 7-day payment grace period expired (BR-121)',
                activationStatus: 'CANCELLED_UNPAID',
              },
            });

            // 4. Also ensure organization engagement remains on Trial or locked
            if (inv.organizationId) {
              const orgsCol = this.connection.db.collection('organizations');
              await orgsCol.updateOne(
                { _id: inv.organizationId, upgradePending: true },
                {
                  $set: {
                    upgradePending: false,
                    lastUpgradeCanceledAt: new Date(),
                    upgradeCancelReason: 'Unpaid invoice exceeded 7-day grace period',
                  },
                },
              );
            }
          }

          // 5. Record Immutable Audit Log (retained for minimum 7 years - BR-82)
          const sevenYearsMs = 7 * 365.25 * 24 * 60 * 60 * 1000;
          await this.auditLogModel.create({
            action: 'PAYMENT_GRACE_PERIOD_EXPIRED',
            resourceType: 'INVOICE',
            resourceId: invIdStr,
            organizationId: inv.organizationId,
            actorUserId: undefined, // System automated job
            eventKey: `payment-grace-expired-${invIdStr}-${Date.now()}`,
            metadata: {
              invoiceNumber: invoiceNum,
              amountVnd: String(inv.amountVnd || 0),
              gracePeriodDays: '7',
              businessRules: 'BR-120, BR-121, Non-Screen #42',
              actionTaken: 'UPGRADE_AUTO_CANCELLED',
            },
            expiresAt: new Date(Date.now() + sevenYearsMs),
          });

          // 6. Notify Customer
          if (inv.userId) {
            await this.notificationModel
              .create({
                userId: inv.userId,
                type: 'PAYMENT_EXPIRED',
                title: 'Web 3 Upgrade Canceled (Payment Overdue)',
                message: `The 7-day grace period for invoice ${invoiceNum} has expired without payment. Your Web 3 upgrade request has been canceled.`,
                resourceType: 'INVOICE',
                resourceId: invIdStr,
                link: `/billing/invoices/${invIdStr}`,
                eventKey: `notif-payment-expired-${invIdStr}`,
                isRead: false,
              })
              .catch((err) => {
                this.logger.warn(`Failed to create user notification for ${invIdStr}: ${err.message}`);
              });
          }

          cancelledInvoices.push(invoiceNum);
          this.logger.log(`[PendingPaymentCheckJob] Successfully processed expired invoice ${invoiceNum}`);
        } catch (itemErr: any) {
          const errMsg = `Failed to process expired invoice ${inv.invoiceNumber || inv._id}: ${itemErr.message}`;
          this.logger.error(errMsg, itemErr.stack);
          errors.push(errMsg);
        }
      }

      return {
        processedCount: cancelledInvoices.length,
        cancelledInvoices,
        errors,
      };
    } finally {
      this.isProcessing = false;
    }
  }
}
