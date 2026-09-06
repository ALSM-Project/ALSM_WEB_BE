import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import {
  BillingCycle,
  PLAN_CATALOGUE,
  PlanTier,
  SubscriptionStatus,
} from '../domain/billing.types';
import {
  INVOICE_REPOSITORY,
  IInvoiceRepository,
  IPlanRepository,
  ISubscriptionRepository,
  PLAN_REPOSITORY,
  PlanProps,
  SUBSCRIPTION_REPOSITORY,
  SubscriptionProps,
} from '../domain/billing.repository.interface';

@Injectable()
export class BillingService implements OnModuleInit {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @Inject(SUBSCRIPTION_REPOSITORY)
    private readonly subscriptionRepo: ISubscriptionRepository,
    @Inject(INVOICE_REPOSITORY)
    private readonly invoiceRepo: IInvoiceRepository,
    @Inject(PLAN_REPOSITORY)
    private readonly planRepo: IPlanRepository,
  ) {}

  async onModuleInit() {
    try {
      const defaultCatalog: PlanProps[] = PLAN_CATALOGUE.map((p) => ({
        id: '',
        tier: p.tier,
        name: p.name,
        description: p.description,
        monthlyPriceVnd: p.monthlyPriceVnd,
        annualPriceVnd: p.annualPriceVnd,
        isPopular: p.isPopular,
        maxProjects: p.maxProjects,
        maxScreensPerMonth: p.maxScreensPerMonth,
        storageGb: p.storageGb,
        features: p.features,
      }));
      await this.planRepo.seedDefaults(defaultCatalog);
      this.logger.log('Subscription plans initialized in MongoDB repository');
    } catch (err) {
      this.logger.error('Failed to seed default subscription plans in MongoDB:', err);
    }
  }

  // ─── Plans ───────────────────────────────────────────────

  async getPlans() {
    const plans = await this.planRepo.findAllActive();
    return plans.map((p) => ({
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

  async getCurrentSubscription(userId: string): Promise<SubscriptionProps | null> {
    return this.subscriptionRepo.findActiveByUser(userId);
  }

  // ─── Create Subscription (Trial) ────────────────────────

  async activateTrial(userId: string, organizationId: string) {
    const existing = await this.subscriptionRepo.findActiveByUser(userId);
    if (existing && existing.status !== SubscriptionStatus.PENDING_PAYMENT) {
      throw new ConflictException({
        code: 'SUBSCRIPTION_EXISTS',
        message: 'You already have an active subscription or trial.',
      });
    }

    let plan = await this.planRepo.findByTier(PlanTier.PROFESSIONAL);
    if (!plan) {
      const all = await this.planRepo.findAllActive();
      plan = all[0] || {
        id: '',
        tier: PlanTier.PROFESSIONAL,
        name: 'Professional',
        description: 'Advanced capabilities',
        monthlyPriceVnd: 499000,
        annualPriceVnd: 399000,
        isPopular: true,
        maxProjects: -1,
        maxScreensPerMonth: 100,
        storageGb: 50,
        features: [],
      };
    }

    const now = new Date();
    const trialEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

    const subscription = await this.subscriptionRepo.create({
      userId,
      organizationId,
      planTier: plan.tier,
      planName: plan.name,
      billingCycle: BillingCycle.MONTHLY,
      status: SubscriptionStatus.TRIAL,
      amountVnd: 0,
      trialEndsAt: trialEnd,
      currentPeriodStart: now,
      currentPeriodEnd: trialEnd,
    });

    this.logger.log(`Trial activated for user ${userId}, ends ${trialEnd.toISOString()}`);
    return subscription;
  }

  // ─── Create Paid Subscription ────────────────────────────

  async createPaidSubscription(
    userId: string,
    organizationId: string,
    planTier: PlanTier,
    billingCycle: BillingCycle,
  ) {
    const plan = await this.planRepo.findByTier(planTier);
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

    const subscription = await this.subscriptionRepo.create({
      userId,
      organizationId,
      planTier,
      planName: plan.name,
      billingCycle,
      status: SubscriptionStatus.PENDING_PAYMENT,
      amountVnd,
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
    });

    this.logger.log(`Subscription created for user ${userId}, plan=${planTier}, awaiting payment`);
    return subscription;
  }

  // ─── Activate Subscription ────────────────────────────────

  async activateSubscription(subscriptionId: string) {
    const sub = await this.subscriptionRepo.updateStatus(subscriptionId, SubscriptionStatus.ACTIVE);
    if (!sub) throw new NotFoundException('Subscription not found');

    this.logger.log(`Subscription ${subscriptionId} activated`);
    return sub;
  }

  // ─── Upgrade Subscription ────────────────────────────────

  async getUpgradePreview(userId: string, targetPlanTier: PlanTier) {
    const current = await this.subscriptionRepo.findActiveByUser(userId);
    if (!current) throw new NotFoundException('No active subscription found');

    const currentPlan = await this.planRepo.findByTier(current.planTier);
    const targetPlan = await this.planRepo.findByTier(targetPlanTier);
    if (!targetPlan) throw new BadRequestException('Target plan not found');

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
    const sub = await this.subscriptionRepo.findActiveByUser(userId);
    if (!sub) throw new NotFoundException('No active subscription to cancel');

    const updated = await this.subscriptionRepo.cancel(sub.id, reason, feedback);

    this.logger.log(`Subscription ${sub.id} cancelled by user ${userId}: ${reason}`);
    return {
      id: updated?.id || sub.id,
      status: updated?.status || SubscriptionStatus.CANCELLED,
      cancelledAt: updated?.cancelledAt || new Date(),
      accessUntil: sub.currentPeriodEnd,
    };
  }

  // ─── Invoices ────────────────────────────────────────────

  async getInvoices(userId: string) {
    return this.invoiceRepo.findRecentByUser(userId);
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
    const count = await this.invoiceRepo.countDocuments();
    const invoiceNumber = `INV-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`;

    const invoice = await this.invoiceRepo.create({
      userId,
      organizationId,
      subscriptionId,
      invoiceNumber,
      planTier,
      planName,
      amountVnd,
      status: 'PENDING' as any,
      billingPeriodStart: periodStart,
      billingPeriodEnd: periodEnd,
    });

    this.logger.log(`Invoice ${invoiceNumber} created for user ${userId}`);
    return invoice;
  }

  async markInvoicePaid(invoiceId: string, paymentMethod: string) {
    const invoice = await this.invoiceRepo.markPaid(invoiceId, paymentMethod);
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }
}
