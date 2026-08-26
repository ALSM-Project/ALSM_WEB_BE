import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  BillingCycle,
  InvoiceStatus,
  PLAN_CATALOGUE,
  PlanTier,
  SubscriptionStatus,
} from '../domain/billing.types';
import {
  Subscription,
  SubscriptionDocument,
} from '../infrastructure/subscription.schema';
import { Invoice, InvoiceDocument } from '../infrastructure/invoice.schema';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @InjectModel(Subscription.name) private readonly subscriptionModel: Model<SubscriptionDocument>,
    @InjectModel(Invoice.name) private readonly invoiceModel: Model<InvoiceDocument>,
  ) {}

  // ─── Plans ───────────────────────────────────────────────

  getPlans() {
    return PLAN_CATALOGUE.map((p) => ({
      id: p.tier,
      name: p.name,
      description: p.description,
      monthlyPrice: p.monthlyPriceVnd,
      annualPrice: p.annualPriceVnd,
      isPopular: p.isPopular,
      features: p.features,
    }));
  }

  // ─── Current Subscription ────────────────────────────────

  async getCurrentSubscription(userId: string) {
    const sub = await this.subscriptionModel
      .findOne({
        userId: new Types.ObjectId(userId),
        status: { $in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL, SubscriptionStatus.PENDING_PAYMENT] },
      })
      .sort({ createdAt: -1 })
      .lean();

    if (!sub) return null;

    return {
      id: sub._id.toString(),
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

  // ─── Create Subscription (Trial) ────────────────────────

  async activateTrial(userId: string, organizationId: string) {
    // Check no active subscription
    const existing = await this.subscriptionModel.findOne({
      userId: new Types.ObjectId(userId),
      status: { $in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL] },
    });
    if (existing) {
      throw new ConflictException({
        code: 'SUBSCRIPTION_EXISTS',
        message: 'You already have an active subscription or trial.',
      });
    }

    const plan = PLAN_CATALOGUE.find((p) => p.tier === PlanTier.PROFESSIONAL)!;
    const now = new Date();
    const trialEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000); // 14 days

    const subscription = await this.subscriptionModel.create({
      userId: new Types.ObjectId(userId),
      organizationId: new Types.ObjectId(organizationId),
      planTier: PlanTier.PROFESSIONAL,
      planName: plan.name,
      billingCycle: BillingCycle.MONTHLY,
      status: SubscriptionStatus.TRIAL,
      amountVnd: 0,
      trialEndsAt: trialEnd,
      currentPeriodStart: now,
      currentPeriodEnd: trialEnd,
    });

    this.logger.log(`Trial activated for user ${userId}, ends ${trialEnd.toISOString()}`);

    return {
      id: subscription._id.toString(),
      planTier: subscription.planTier,
      planName: subscription.planName,
      status: subscription.status,
      trialEndsAt: subscription.trialEndsAt,
    };
  }

  // ─── Create Paid Subscription ────────────────────────────

  async createPaidSubscription(
    userId: string,
    organizationId: string,
    planTier: PlanTier,
    billingCycle: BillingCycle,
  ) {
    const plan = PLAN_CATALOGUE.find((p) => p.tier === planTier);
    if (!plan) throw new BadRequestException({ code: 'INVALID_PLAN', message: 'Plan not found.' });
    if (plan.tier === PlanTier.ENTERPRISE) {
      throw new BadRequestException({
        code: 'CONTACT_SALES',
        message: 'Enterprise plans require contacting sales.',
      });
    }

    const amountVnd =
      billingCycle === BillingCycle.ANNUAL ? plan.annualPriceVnd * 12 : plan.monthlyPriceVnd;

    const now = new Date();
    const periodEnd = new Date(now);
    if (billingCycle === BillingCycle.ANNUAL) {
      periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    } else {
      periodEnd.setMonth(periodEnd.getMonth() + 1);
    }

    const subscription = await this.subscriptionModel.create({
      userId: new Types.ObjectId(userId),
      organizationId: new Types.ObjectId(organizationId),
      planTier,
      planName: plan.name,
      billingCycle,
      status: SubscriptionStatus.PENDING_PAYMENT,
      amountVnd,
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
    });

    this.logger.log(`Subscription created for user ${userId}, plan=${planTier}, awaiting payment`);

    return {
      id: subscription._id.toString(),
      planTier: subscription.planTier,
      planName: subscription.planName,
      status: subscription.status,
      amountVnd: subscription.amountVnd,
      billingCycle: subscription.billingCycle,
    };
  }

  // ─── Activate Subscription (called after payment confirmed) ──

  async activateSubscription(subscriptionId: string) {
    const sub = await this.subscriptionModel.findById(subscriptionId);
    if (!sub) throw new NotFoundException('Subscription not found');

    sub.status = SubscriptionStatus.ACTIVE;
    await sub.save();

    this.logger.log(`Subscription ${subscriptionId} activated`);
    return sub;
  }

  // ─── Upgrade Subscription ────────────────────────────────

  async getUpgradePreview(userId: string, targetPlanTier: PlanTier) {
    const current = await this.subscriptionModel.findOne({
      userId: new Types.ObjectId(userId),
      status: { $in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL] },
    });
    if (!current) throw new NotFoundException('No active subscription found');

    const currentPlan = PLAN_CATALOGUE.find((p) => p.tier === current.planTier);
    const targetPlan = PLAN_CATALOGUE.find((p) => p.tier === targetPlanTier);
    if (!targetPlan) throw new BadRequestException('Target plan not found');

    // Calculate prorated amounts
    const now = new Date();
    const periodEnd = current.currentPeriodEnd || now;
    const periodStart = current.currentPeriodStart || now;
    const totalDays = Math.max(1, Math.ceil((periodEnd.getTime() - periodStart.getTime()) / (24 * 60 * 60 * 1000)));
    const remainingDays = Math.max(0, Math.ceil((periodEnd.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));

    const dailyRateCurrent = current.amountVnd / totalDays;
    const creditRemaining = Math.round(dailyRateCurrent * remainingDays);

    const targetAmount =
      current.billingCycle === BillingCycle.ANNUAL
        ? targetPlan.annualPriceVnd * 12
        : targetPlan.monthlyPriceVnd;

    const proratedNewCost = Math.round((targetAmount / totalDays) * remainingDays);
    const dueToday = Math.max(0, proratedNewCost - creditRemaining);

    return {
      currentPlan: {
        tier: current.planTier,
        name: currentPlan?.name || current.planName,
        amountVnd: current.amountVnd,
      },
      targetPlan: {
        tier: targetPlan.tier,
        name: targetPlan.name,
        monthlyPriceVnd: targetPlan.monthlyPriceVnd,
        features: targetPlan.features,
      },
      proration: {
        creditRemainingVnd: creditRemaining,
        proratedNewCostVnd: proratedNewCost,
        dueTodayVnd: dueToday,
        remainingDays,
      },
    };
  }

  // ─── Cancel Subscription ─────────────────────────────────

  async cancelSubscription(userId: string, reason: string, feedback?: string) {
    const sub = await this.subscriptionModel.findOne({
      userId: new Types.ObjectId(userId),
      status: { $in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL] },
    });
    if (!sub) throw new NotFoundException('No active subscription to cancel');

    sub.status = SubscriptionStatus.CANCELLED;
    sub.cancelledAt = new Date();
    sub.cancelReason = reason;
    sub.cancelFeedback = feedback;
    await sub.save();

    this.logger.log(`Subscription ${sub._id} cancelled by user ${userId}: ${reason}`);

    return {
      id: sub._id.toString(),
      status: sub.status,
      cancelledAt: sub.cancelledAt,
      accessUntil: sub.currentPeriodEnd,
    };
  }

  // ─── Invoices ────────────────────────────────────────────

  async getInvoices(userId: string) {
    const invoices = await this.invoiceModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    return invoices.map((inv) => ({
      id: inv._id.toString(),
      invoiceNumber: inv.invoiceNumber,
      planName: inv.planName,
      amountVnd: inv.amountVnd,
      status: inv.status,
      billingPeriodStart: inv.billingPeriodStart,
      billingPeriodEnd: inv.billingPeriodEnd,
      paidAt: inv.paidAt,
      paymentMethod: inv.paymentMethod,
      createdAt: inv.createdAt,
    }));
  }

  async createInvoice(
    userId: string,
    organizationId: string,
    subscriptionId: string,
    planTier: PlanTier,
    planName: string,
    amountVnd: number,
    periodStart: Date,
    periodEnd: Date,
  ) {
    const count = await this.invoiceModel.countDocuments();
    const invoiceNumber = `INV-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`;

    const invoice = await this.invoiceModel.create({
      userId: new Types.ObjectId(userId),
      organizationId: new Types.ObjectId(organizationId),
      subscriptionId: new Types.ObjectId(subscriptionId),
      invoiceNumber,
      planTier,
      planName,
      amountVnd,
      status: InvoiceStatus.PENDING,
      billingPeriodStart: periodStart,
      billingPeriodEnd: periodEnd,
    });

    this.logger.log(`Invoice ${invoiceNumber} created for user ${userId}`);
    return invoice;
  }

  async markInvoicePaid(invoiceId: string, paymentMethod: string) {
    const invoice = await this.invoiceModel.findById(invoiceId);
    if (!invoice) throw new NotFoundException('Invoice not found');

    invoice.status = InvoiceStatus.PAID;
    invoice.paidAt = new Date();
    invoice.paymentMethod = paymentMethod;
    await invoice.save();

    return invoice;
  }
}
