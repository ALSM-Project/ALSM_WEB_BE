import { Inject, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { generateCleanBankQrDataUrl } from '../../../shared/utils/bank-qr.helper';
import { EnterpriseContractService } from '../../crm/application/enterprise-contract.service';
import { ConfigService } from '@nestjs/config';
import {
  CassoTransaction,
  DEFAULT_BANK_CONFIG,
  PaymentStatus,
  PlanTier,
} from '../domain/billing.types';
import { BillingService } from './billing.service';
import {
  BANK_CONFIG_REPOSITORY,
  IBankConfigRepository,
  BankConfigProps,
  IPaymentRepository,
  PAYMENT_REPOSITORY,
} from '../domain/billing.repository.interface';

@Injectable()
export class PaymentService implements OnModuleInit {
  private readonly logger = new Logger(PaymentService.name);

  private webhookLogs: Array<{
    id: string;
    timestamp: string;
    clientIp?: string;
    headers?: Record<string, string>;
    transactionsCount: number;
    matchedCount: number;
    transactions: any[];
    matchedDetails: any[];
    error?: string;
  }> = [];

  private isSyncingCasso = false;
  private processedCassoTxIds = new Set<number>();
  private syncIntervalTimer: any = null;
  private lastSyncTimestamp = 0;

  constructor(
    @Inject(PAYMENT_REPOSITORY)
    private readonly paymentRepo: IPaymentRepository,
    @Inject(BANK_CONFIG_REPOSITORY)
    private readonly bankConfigRepo: IBankConfigRepository,
    private readonly billingService: BillingService,
    private readonly configService: ConfigService,
    private readonly moduleRef: ModuleRef,
  ) {}

  recordWebhookLog(logEntry: any) {
    this.webhookLogs.unshift(logEntry);
    if (this.webhookLogs.length > 100) {
      this.webhookLogs.pop();
    }

    try {
      const fsModule = require('fs');
      const pathModule = require('path');
      const logDir = pathModule.resolve(process.cwd(), 'logs');
      if (!fsModule.existsSync(logDir)) {
        fsModule.mkdirSync(logDir, { recursive: true });
      }
      const logFile = pathModule.join(logDir, 'casso-webhook.log');
      const line = `[${logEntry.timestamp}] [IP: ${logEntry.clientIp || 'unknown'}] TX: ${logEntry.transactionsCount}, Matched: ${logEntry.matchedCount} | Details: ${JSON.stringify(logEntry.matchedDetails)} | Error: ${logEntry.error || 'none'}\n`;
      fsModule.appendFileSync(logFile, line, 'utf8');
    } catch (e: any) {
      this.logger.warn(`Failed to write to casso-webhook.log: ${e.message}`);
    }
  }

  getWebhookLogs() {
    return {
      total: this.webhookLogs.length,
      currentCloudflareUrl: 'https://socks-die-thick-originally.trycloudflare.com',
      logs: this.webhookLogs,
    };
  }

  async onModuleInit() {
    try {
      await this.bankConfigRepo.seedDefaults(DEFAULT_BANK_CONFIG);
    } catch (err) {
      this.logger.error('Failed to seed payment bank config in MongoDB:', err);
    }

    // ─── START AUTOMATIC CASSO BANK TRANSACTION SYNC (Every 1 minute = 60000ms) ───
    const cassoKey = this.configService.get<string>('CASSO_API_KEY');
    if (cassoKey) {
      setTimeout(() => this.syncCassoTransactions().catch(() => {}), 1000);

      this.syncIntervalTimer = setInterval(() => {
        this.syncCassoTransactions().catch(() => {});
      }, 60000);
    } else {
      this.logger.warn('CASSO_API_KEY not configured. Background auto-sync is disabled.');
    }
  }

  // ─── Direct Casso API Synchronization Method ───────────────
  async syncCassoTransactions(force = false) {
    const cassoApiKey = this.configService.get<string>('CASSO_API_KEY');
    if (!cassoApiKey || this.isSyncingCasso) return { synced: 0, matched: 0 };

    // Throttle calls to minimum 15 seconds unless forced
    const now = Date.now();
    if (!force && now - this.lastSyncTimestamp < 15000) {
      return { synced: 0, matched: 0, throttled: true };
    }

    // Only query Casso API if there is at least one invoice/contract actively awaiting payment
    try {
      const enterpriseContractService = this.moduleRef.get(EnterpriseContractService, { strict: false });
      if (enterpriseContractService && enterpriseContractService['invoicesCol']) {
        const pendingCount = await enterpriseContractService['invoicesCol'].countDocuments({
          status: { $in: ['ISSUED', 'PENDING', 'PAYMENT_SUBMITTED', 'PROCESSING', 'Pending Payment', 'Payment Verification'] },
        });
        if (pendingCount === 0) {
          return { synced: 0, matched: 0, skipped: true, reason: 'NO_PENDING_INVOICES' };
        }
      }
    } catch {
      // non-blocking fallback
    }

    this.lastSyncTimestamp = now;
    this.isSyncingCasso = true;
    try {
      const cleanKey = cassoApiKey.trim();
      const response = await fetch('https://oauth.casso.vn/v2/transactions?page=1&pageSize=30&sort=DESC', {
        headers: {
          Authorization: `Apikey ${cleanKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        return { synced: 0, matched: 0 };
      }

      const resData = (await response.json()) as any;
      const records = resData?.data?.records;

      if (Array.isArray(records) && records.length > 0) {
        const incomingTxs = records.filter(
          (r: any) => r.amount > 0 && !this.processedCassoTxIds.has(Number(r.id)),
        );

        if (incomingTxs.length > 0) {
          const formattedTxs: CassoTransaction[] = incomingTxs.map((r: any) => ({
            id: r.id,
            amount: r.amount,
            description: r.description,
            when: r.when,
            bank_sub_acc_id: r.bank_sub_acc_id,
            subAccId: r.subAccId,
            corresponsiveName: r.corresponsiveName,
            corresponsiveAccount: r.corresponsiveAccount,
            corresponsiveBankId: r.corresponsiveBankId,
            corresponsiveBankName: r.corresponsiveBankName,
          }));

          const result = await this.handleCassoWebhook(formattedTxs, 'CASSO_API_POLLER');

          for (const tx of formattedTxs) {
            this.processedCassoTxIds.add(Number(tx.id));
          }

          return { synced: incomingTxs.length, matched: result.matched };
        }
      }
      return { synced: 0, matched: 0 };
    } catch (err: any) {
      return { synced: 0, matched: 0, error: err.message };
    } finally {
      this.isSyncingCasso = false;
    }
  }

  // ─── Bank Config Get / Update ─────────────────────────────

  async getBankConfig() {
    return this.bankConfigRepo.getActiveConfig();
  }

  async updateBankConfig(props: Partial<BankConfigProps>) {
    return this.bankConfigRepo.updateConfig(props);
  }

  // ─── Casso Webhook Validation ─────────────────────────────

  validateCassoWebhook(authHeader?: string, secureToken?: string, isTestCall = false): boolean {
    const expectedKey = this.configService.get<string>('CASSO_API_KEY');
    if (!expectedKey) return true; // dev mode default

    const candidate = (secureToken || authHeader || '').replace(/^Apikey\s+/i, '').trim();
    const cleanExpected = expectedKey.replace(/[\r\n\s]/g, '').trim();
    const cleanCandidate = candidate.replace(/[\r\n\s]/g, '').trim();

    if (cleanCandidate && cleanCandidate === cleanExpected) {
      return true;
    }

    if (isTestCall) {
      return true;
    }

    return false;
  }

  // ─── VietQR Payment Order Creation ────────────────────────

  async createQRPayment(
    userId: string,
    organizationId: string,
    planTier: PlanTier,
    amountVnd: number,
    subscriptionId?: string,
    invoiceId?: string,
  ) {
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const referenceCode = `ALSM${randomSuffix}`;

    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72 hours expiry (bỏ giới hạn 15 phút)

    // Fetch active bank account configuration from MongoDB
    const bank = await this.bankConfigRepo.getActiveConfig();
    const addInfo = encodeURIComponent(referenceCode);
    const accountName = encodeURIComponent(bank.accountName);
    const qrDataUrl = await generateCleanBankQrDataUrl({
      bankBin: bank.bankId || '970422',
      accountNumber: bank.accountNumber,
      accountName: bank.accountName,
      amount: amountVnd,
      message: referenceCode,
    });

    const payment = await this.paymentRepo.create({
      userId,
      organizationId,
      subscriptionId,
      invoiceId,
      planTier,
      amountVnd,
      status: PaymentStatus.PENDING,
      referenceCode,
      qrDataUrl,
      bankName: bank.bankName,
      accountNumber: bank.accountNumber,
      accountName: bank.accountName,
      expiresAt,
    });



    return {
      paymentId: payment.id,
      subscriptionId: payment.subscriptionId,
      invoiceNumber: payment.invoiceId || 'INV-PENDING',
      planName: planTier,
      amountVnd: payment.amountVnd,
      currency: 'VND',
      referenceCode: payment.referenceCode,
      qrDataUrl: payment.qrDataUrl,
      bankName: payment.bankName,
      accountNumber: payment.accountNumber,
      accountName: payment.accountName,
      expiresAt: payment.expiresAt.toISOString(),
    };
  }

  // ─── Check Payment Status (Polling Endpoint) ──────────────

  async getPaymentStatus(paymentId: string) {
    const payment = await this.paymentRepo.findById(paymentId);
    if (!payment) throw new NotFoundException('Payment not found');

    if (payment.status === PaymentStatus.PENDING && new Date() > payment.expiresAt) {
      await this.paymentRepo.updateStatus(paymentId, PaymentStatus.EXPIRED);
      return { status: PaymentStatus.EXPIRED, paidAt: null, amountVnd: payment.amountVnd };
    }

    return {
      status: payment.status,
      paidAt: payment.paidAt,
      amountVnd: payment.amountVnd,
    };
  }

  // ─── Casso Webhook Handler ───────────────────────────────

  async handleCassoWebhook(
    transactions: CassoTransaction[],
    clientIp?: string,
    headers?: Record<string, string>,
  ) {
    let matchedCount = 0;
    const matchedDetails: any[] = [];
    let processingError: string | undefined;

    try {
      for (const tx of transactions) {
        let isTxMatched = false;

        const description = (tx.description || '').toUpperCase();
        const normalizedDesc = description.replace(/[^A-Z0-9]/g, '');

        // 1. Check pending individual payments in paymentRepo
        const pendingPayments = await this.paymentRepo.findPending();

        for (const payment of pendingPayments) {
          const refUpper = payment.referenceCode.toUpperCase();
          const refClean = refUpper.replace(/[^A-Z0-9]/g, '');

          const isMatched = description.includes(refUpper) || normalizedDesc.includes(refClean);

          if (isMatched && tx.amount >= payment.amountVnd) {
            await this.paymentRepo.updateStatus(
              payment.id,
              PaymentStatus.COMPLETED,
              new Date(),
              String(tx.id),
            );

            if (payment.subscriptionId) {
              await this.billingService.activateSubscription(payment.subscriptionId);
            }

            if (payment.invoiceId) {
              await this.billingService.markInvoicePaid(payment.invoiceId, 'QR Bank Transfer');
            }

            matchedCount++;
            isTxMatched = true;
            matchedDetails.push({
              type: 'SUBSCRIPTION_PAYMENT',
              reference: payment.referenceCode,
              txId: tx.id,
              amount: tx.amount,
            });
            break;
          } else if (isMatched && tx.amount < payment.amountVnd) {
            this.logger.warn(
              `⚠️ Partial payment detected! Ref=${payment.referenceCode}, Required=${payment.amountVnd}, Received=${tx.amount}`,
            );
          }
        }

        // 2. Check for Enterprise Contracts or Contract Invoices
        if (!isTxMatched) {
          try {
            const enterpriseContractService = this.moduleRef.get(EnterpriseContractService, { strict: false });
            if (enterpriseContractService) {
              let rawRef: string | null = null;

              // 2.1 FIRST: Match against actual database pending invoices by normalized description
              if (enterpriseContractService['invoicesCol']) {
                const pendingInvoices = await enterpriseContractService['invoicesCol']
                  .find({ status: { $in: ['ISSUED', 'PENDING', 'PAYMENT_SUBMITTED', 'PROCESSING', 'Pending Payment', 'Payment Verification'] } })
                  .toArray();

                for (const inv of pendingInvoices) {
                  const cleanInv = (inv.invoiceNumber || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
                  const cleanCtr = (inv.contractNumber || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
                  const strippedInv = cleanInv.replace(/^(DEMO|ALSM)/, '');
                  const strippedCtr = cleanCtr.replace(/^(ALSM)/, '');

                  if (
                    (cleanInv && normalizedDesc.includes(cleanInv)) ||
                    (cleanCtr && normalizedDesc.includes(cleanCtr)) ||
                    (strippedInv.length >= 6 && normalizedDesc.includes(strippedInv)) ||
                    (strippedCtr.length >= 6 && normalizedDesc.includes(strippedCtr))
                  ) {
                    rawRef = inv.invoiceNumber;
                    break;
                  }
                }
              }

              // 2.2 SECOND: Fallback regex if not found in pending list
              if (!rawRef) {
                const contractMatch = description.match(/(ALSM-CTR-[A-Z0-9-]+|DEMO-INV-[A-Z0-9-]+|INV-[A-Z0-9-]+|ALSMCTR[A-Z0-9]+|DEMOINV[A-Z0-9]+|INV[A-Z0-9]+)/i);
                rawRef = contractMatch ? contractMatch[1].toUpperCase() : null;
              }

              if (rawRef) {
                const confirmRes = await enterpriseContractService.confirmContractPayment(
                  rawRef,
                  { note: `Auto-reconciled via Casso Bank Webhook (TxID: ${tx.id}, Amount: ${tx.amount} VND)` },
                  'CASSO_WEBHOOK',
                );
                if (confirmRes?.success) {
                  matchedCount++;
                  isTxMatched = true;
                  matchedDetails.push({
                    type: 'ENTERPRISE_CONTRACT',
                    reference: rawRef,
                    txId: tx.id,
                    amount: tx.amount,
                    alreadyConfirmed: confirmRes.alreadyConfirmed || false,
                  });
                }
              }
            }
          } catch (err: any) {
            processingError = err.message;
          }
        }
      }
    } catch (e: any) {
      processingError = e.message;
    }

    const logEntry = {
      id: Math.random().toString(36).substring(2, 10),
      timestamp: new Date().toISOString(),
      clientIp,
      headers: headers ? { 'secure-token': headers['secure-token'], 'authorization': headers['authorization'] } : undefined,
      transactionsCount: transactions.length,
      matchedCount,
      transactions: transactions.map(t => ({ id: t.id, amount: t.amount, desc: t.description })),
      matchedDetails,
      error: processingError,
    };
    this.recordWebhookLog(logEntry);

    return { processed: transactions.length, matched: matchedCount, matchedDetails };
  }
}
