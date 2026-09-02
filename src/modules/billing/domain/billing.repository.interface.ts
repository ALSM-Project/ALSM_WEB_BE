import {
  BillingCycle,
  InvoiceStatus,
  PaymentStatus,
  PlanTier,
  SubscriptionStatus,
} from './billing.types';

export interface SubscriptionProps {
  id: string;
  userId: string;
  organizationId: string;
  planTier: PlanTier;
  planName: string;
  billingCycle: BillingCycle;
  status: SubscriptionStatus;
  amountVnd: number;
  trialEndsAt?: Date;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  cancelledAt?: Date;
  cancelReason?: string;
  cancelFeedback?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface InvoiceProps {
  id: string;
  userId: string;
  organizationId: string;
  subscriptionId?: string;
  invoiceNumber: string;
  planTier: PlanTier;
  planName: string;
  amountVnd: number;
  status: InvoiceStatus;
  billingPeriodStart: Date;
  billingPeriodEnd: Date;
  paidAt?: Date;
  paymentMethod?: string;
  createdAt?: Date;
}

export interface PaymentProps {
  id: string;
  userId: string;
  organizationId: string;
  subscriptionId?: string;
  invoiceId?: string;
  planTier: PlanTier;
  amountVnd: number;
  status: PaymentStatus;
  referenceCode: string;
  qrDataUrl: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  expiresAt: Date;
  paidAt?: Date;
  cassoTransactionId?: string;
  createdAt?: Date;
}

export interface ISubscriptionRepository {
  findById(id: string): Promise<SubscriptionProps | null>;
  findActiveByUser(userId: string): Promise<SubscriptionProps | null>;
  create(props: Omit<SubscriptionProps, 'id'>): Promise<SubscriptionProps>;
  updateStatus(id: string, status: SubscriptionStatus): Promise<SubscriptionProps | null>;
  cancel(id: string, reason: string, feedback?: string): Promise<SubscriptionProps | null>;
}

export interface IInvoiceRepository {
  findById(id: string): Promise<InvoiceProps | null>;
  findRecentByUser(userId: string, limit?: number): Promise<InvoiceProps[]>;
  countDocuments(): Promise<number>;
  create(props: Omit<InvoiceProps, 'id'>): Promise<InvoiceProps>;
  markPaid(id: string, paymentMethod: string): Promise<InvoiceProps | null>;
}

export interface IPaymentRepository {
  findById(id: string): Promise<PaymentProps | null>;
  findPending(): Promise<PaymentProps[]>;
  create(props: Omit<PaymentProps, 'id'>): Promise<PaymentProps>;
  updateStatus(id: string, status: PaymentStatus, paidAt?: Date, cassoTxId?: string): Promise<PaymentProps | null>;
}

export const SUBSCRIPTION_REPOSITORY = Symbol('SUBSCRIPTION_REPOSITORY');
export const INVOICE_REPOSITORY = Symbol('INVOICE_REPOSITORY');
export const PAYMENT_REPOSITORY = Symbol('PAYMENT_REPOSITORY');
