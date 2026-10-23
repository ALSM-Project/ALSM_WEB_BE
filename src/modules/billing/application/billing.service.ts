import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model } from 'mongoose';
import { User, UserDocument } from '../../users/infrastructure/user.schema';
import { Organization, OrganizationDocument } from '../../organizations/infrastructure/organization.schema';
import { ListInvoicesQueryDto } from '../presentation/billing.dto';
import { generateInvoicePdfBuffer } from './invoice-pdf.generator';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { OrganizationContextService } from '../../organizations/application/organization-context.service';
import { OrganizationRole } from '../../organizations/domain/organization.types';
import { AUDIT_REPOSITORY, AuditRepository } from '../../audit/domain/audit.repository';
import {
  BillingCycle,
  InvoiceStatus,
  PLAN_CATALOGUE,
  PlanTier,
  QuoteRequestStatus,
  SubscriptionStatus,
} from '../domain/billing.types';
import {
  INVOICE_REPOSITORY,
  IInvoiceRepository,
  IPlanRepository,
  IQuoteRequestRepository,
  ISubscriptionRepository,
  PLAN_REPOSITORY,
  PlanProps,
  QUOTE_REQUEST_REPOSITORY,
  QuoteRequestProps,
  SUBSCRIPTION_REPOSITORY,
  SubscriptionProps,
} from '../domain/billing.repository.interface';

@Injectable()
export class BillingService implements OnModuleInit {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @InjectConnection()
    private readonly connection: Connection,
    private readonly organizationContext: OrganizationContextService,
    @Inject(SUBSCRIPTION_REPOSITORY)
    private readonly subscriptionRepo: ISubscriptionRepository,
    @Inject(INVOICE_REPOSITORY)
    private readonly invoiceRepo: IInvoiceRepository,
    @Inject(PLAN_REPOSITORY)
    private readonly planRepo: IPlanRepository,
    @Inject(QUOTE_REQUEST_REPOSITORY)
    private readonly quoteRequestRepo: IQuoteRequestRepository,
    @Optional()
    @Inject(AUDIT_REPOSITORY)
    private readonly audit?: AuditRepository,
    @Optional()
    @InjectModel(User.name)
    private readonly userModel?: Model<UserDocument>,
    @Optional()
    @InjectModel(Organization.name)
    private readonly orgModel?: Model<OrganizationDocument>,
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
      await this.seedDefaultEnterpriseInvoices();
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
    const totalDays = Math.max(
      1,
      Math.ceil((periodEnd.getTime() - periodStart.getTime()) / (24 * 60 * 60 * 1000)),
    );
    const remainingDays = Math.max(
      0,
      Math.ceil((periodEnd.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)),
    );

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

  async getInvoices(
    userOrUserId: AuthenticatedUser | string,
    query?: ListInvoicesQueryDto,
  ) {
    const userId = typeof userOrUserId === 'string' ? userOrUserId : userOrUserId.userId;
    const isPlatformAdmin = typeof userOrUserId === 'object' && Boolean(
      userOrUserId.isPlatformAdmin ||
      (userOrUserId as any).roles?.includes('ADMIN') ||
      (userOrUserId as any).role === 'ADMIN'
    );

    let targetOrgId: string | undefined = query?.organizationId;

    if (!isPlatformAdmin) {
      if (query?.organizationId) {
        // Enforce authorization for requested organization
        await this.organizationContext.resolve(userId, query.organizationId);
        targetOrgId = query.organizationId;
      } else {
        // Automatically resolve organization for enterprise members
        try {
          const defaultOrg = await this.organizationContext.resolve(userId);
          targetOrgId = defaultOrg.id;
        } catch {
          // Individual user without organization
        }
      }
    }

    const page = Math.max(1, query?.page || 1);
    const limit = Math.max(1, Math.min(100, query?.limit || 20));
    const skip = (page - 1) * limit;

    if (this.invoiceRepo.findInvoices) {
      const res = await this.invoiceRepo.findInvoices({
        userId: isPlatformAdmin && !targetOrgId ? undefined : userId,
        organizationId: targetOrgId,
        status: query?.status,
        planTier: query?.planTier,
        search: query?.search,
        startDate: query?.startDate,
        endDate: query?.endDate,
        skip,
        limit,
      });

      return {
        items: res.items,
        total: res.total,
        page,
        limit,
        totalPages: Math.ceil(res.total / limit) || 1,
      };
    }

    const items = await this.invoiceRepo.findRecentByUser(userId, limit);
    return {
      items,
      total: items.length,
      page: 1,
      limit,
      totalPages: 1,
    };
  }

  async getInvoiceById(userOrUserId: AuthenticatedUser | string, invoiceId: string) {
    if (!invoiceId || !/^[a-f\d]{24}$/i.test(invoiceId)) {
      throw new BadRequestException({
        code: 'INVALID_INVOICE_ID',
        message: 'Invalid invoice ID format',
      });
    }

    const userId = typeof userOrUserId === 'string' ? userOrUserId : userOrUserId.userId;
    const isPlatformAdmin = typeof userOrUserId === 'object' && Boolean(
      userOrUserId.isPlatformAdmin ||
      (userOrUserId as any).roles?.includes('ADMIN') ||
      (userOrUserId as any).role === 'ADMIN'
    );

    const invoice = await this.invoiceRepo.findById(invoiceId);
    if (!invoice) {
      throw new NotFoundException({
        code: 'INVOICE_NOT_FOUND',
        message: 'Invoice not found',
      });
    }

    // Check authorization: platform admin, invoice creator/owner, or organization member
    let authorized = isPlatformAdmin || invoice.userId === userId;
    if (!authorized && invoice.organizationId) {
      try {
        await this.organizationContext.resolve(userId, invoice.organizationId);
        authorized = true;
      } catch {
        authorized = false;
      }
    }

    if (!authorized) {
      throw new ForbiddenException({
        code: 'INVOICE_ACCESS_DENIED',
        message: 'You do not have permission to view this invoice',
      });
    }

    let organizationName: string | undefined;
    if (invoice.organizationId && this.orgModel) {
      try {
        const orgDoc = await this.orgModel.findById(invoice.organizationId).exec();
        if (orgDoc) organizationName = orgDoc.name;
      } catch {
        // Fallback
      }
    }

    let customerName: string | undefined;
    let customerEmail: string | undefined;
    if (invoice.userId && this.userModel) {
      try {
        const userDoc = await this.userModel.findById(invoice.userId).exec();
        if (userDoc) {
          customerName = userDoc.fullName;
          customerEmail = userDoc.email;
        }
      } catch {
        // Fallback
      }
    }

    const subtotalVnd = invoice.amountVnd;
    const taxRate = 0.1;
    const taxAmountVnd = Math.round(subtotalVnd * taxRate);
    const totalAmountVnd = subtotalVnd + taxAmountVnd;

    const lineItems = [
      {
        description: `${invoice.planName} (${invoice.planTier}) Modernization License & Platform Access`,
        quantity: 1,
        unitPriceVnd: invoice.amountVnd,
        amountVnd: invoice.amountVnd,
      },
    ];

    const refCode = `ALSM${invoice.invoiceNumber.replace(/\D/g, '') || 'INV'}`;
    const paymentDetails = {
      bankName: 'MB Bank (Military Commercial Joint Stock Bank)',
      accountNumber: '090123456789',
      accountName: 'CONG TY CO PHAN ALSM SOFTWARE',
      referenceCode: refCode,
      qrDataUrl: `https://img.vietqr.io/image/MB-090123456789-compact2.png?amount=${invoice.amountVnd}&addInfo=${refCode}&accountName=CONG%20TY%20CO%20PHAN%20ALSM%20SOFTWARE`,
    };

    return {
      ...invoice,
      organizationName: organizationName || 'ALSM Enterprise Client',
      customerName: customerName || (typeof userOrUserId === 'object' ? userOrUserId.email : 'Enterprise Customer'),
      customerEmail: customerEmail || (typeof userOrUserId === 'object' ? userOrUserId.email : 'enterprise@company.com'),
      subtotalVnd,
      taxRate,
      taxAmountVnd,
      totalAmountVnd,
      lineItems,
      paymentDetails,
    };
  }

  async downloadInvoicePdf(userOrUserId: AuthenticatedUser | string, invoiceId: string) {
    const detail = await this.getInvoiceById(userOrUserId, invoiceId);
    const buffer = generateInvoicePdfBuffer(detail);
    return {
      buffer,
      invoiceNumber: detail.invoiceNumber,
      filename: `${detail.invoiceNumber}.pdf`,
    };
  }

  private async seedDefaultEnterpriseInvoices(): Promise<void> {
    try {
      const count = await this.invoiceRepo.countDocuments();
      if (count > 0) return;

      const dummyOrgId = '66d9c84e1234567890abcdef';
      const dummyUserId = '66d9c84e1234567890abc001';

      await this.invoiceRepo.create({
        userId: dummyUserId,
        organizationId: dummyOrgId,
        invoiceNumber: 'INV-2026-0001',
        planTier: PlanTier.ENTERPRISE,
        planName: 'Enterprise Modernization Pilot',
        amountVnd: 150000000,
        status: InvoiceStatus.PAID,
        billingPeriodStart: new Date('2026-08-01T00:00:00.000Z'),
        billingPeriodEnd: new Date('2026-09-01T00:00:00.000Z'),
        paidAt: new Date('2026-08-02T10:15:00.000Z'),
        paymentMethod: 'Bank Wire Transfer',
      });

      await this.invoiceRepo.create({
        userId: dummyUserId,
        organizationId: dummyOrgId,
        invoiceNumber: 'INV-2026-0002',
        planTier: PlanTier.ENTERPRISE,
        planName: 'Enterprise Production Modernization Phase 1',
        amountVnd: 250000000,
        status: InvoiceStatus.PAID,
        billingPeriodStart: new Date('2026-09-01T00:00:00.000Z'),
        billingPeriodEnd: new Date('2026-10-01T00:00:00.000Z'),
        paidAt: new Date('2026-09-03T14:30:00.000Z'),
        paymentMethod: 'Bank Wire Transfer',
      });

      await this.invoiceRepo.create({
        userId: dummyUserId,
        organizationId: dummyOrgId,
        invoiceNumber: 'INV-2026-0003',
        planTier: PlanTier.ENTERPRISE,
        planName: 'Enterprise Premium SLA & Dedicated Support',
        amountVnd: 45000000,
        status: InvoiceStatus.PENDING,
        billingPeriodStart: new Date('2026-10-01T00:00:00.000Z'),
        billingPeriodEnd: new Date('2026-11-01T00:00:00.000Z'),
        paymentMethod: 'QR Bank Transfer',
      });

      this.logger.log('Default enterprise invoices seeded successfully');
    } catch (err) {
      this.logger.warn(`Could not seed default enterprise invoices: ${err}`);
    }
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
      status: InvoiceStatus.PENDING,
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

  // ─── Enterprise Quote Request (UC-32) ───────────────────

  async requestEnterpriseQuote(
    user: AuthenticatedUser,
    dto: {
      fullName: string;
      companyName: string;
      email: string;
      phone?: string;
      message?: string;
    },
  ): Promise<QuoteRequestProps> {
    const fullName = dto.fullName.trim();
    const companyName = dto.companyName.trim();
    const email = dto.email.trim();
    const phone = dto.phone?.trim();
    const message = dto.message?.trim();
    if (fullName.length < 2 || !companyName || !email) {
      throw new BadRequestException('Name, company, and email are required.');
    }
    if (message && message.length > 1000) {
      throw new BadRequestException('Request details must be 1000 characters or fewer.');
    }

    const userId = user.userId;

    const existing = await this.quoteRequestRepo.findPendingByUser(userId);
    if (existing) {
      throw new ConflictException({
        code: 'QUOTE_REQUEST_EXISTS',
        message: 'You already have an open Enterprise quote request.',
      });
    }

    const currentSub = await this.subscriptionRepo.findLatestByUser(userId);
    if (
      currentSub?.planTier === PlanTier.ENTERPRISE &&
      ![SubscriptionStatus.CANCELLED, SubscriptionStatus.EXPIRED].includes(currentSub.status)
    ) {
      throw new ConflictException('An Enterprise subscription already exists for this account.');
    }

    const organization = await this.organizationContext.resolve(user.userId);
    const membership = organization.members.find((member) => member.userId === user.userId);
    if (!membership || ![OrganizationRole.OWNER, OrganizationRole.ADMIN].includes(membership.role)) {
      throw new ForbiddenException('Only organization owners or admins can request an Enterprise migration quote.');
    }
    const organizationId = organization.id;
    const currentPlanTier = currentSub ? currentSub.planTier : PlanTier.STARTER;

    let request: QuoteRequestProps;
    try {
      request = await this.quoteRequestRepo.create({
        userId,
        organizationId,
        fullName,
        companyName,
        email,
        phone: phone || undefined,
        message: message || undefined,
        currentPlanTier,
        status: QuoteRequestStatus.PENDING,
      });
    } catch (error) {
      if ((error as { code?: number })?.code === 11000) {
        throw new ConflictException({ code: 'QUOTE_REQUEST_EXISTS', message: 'You already have an open Enterprise quote request.' });
      }
      throw error;
    }

    this.logger.log(`Enterprise quote requested by user ${userId} for org ${organizationId}`);
    return request;
  }

  async getMyQuoteRequest(userId: string): Promise<QuoteRequestProps | null> {
    return this.quoteRequestRepo.findLatestByUser(userId);
  }

  async submitQuoteAppeal(userId: string, message: string): Promise<QuoteRequestProps> {
    const normalizedMessage = message.trim();
    if (normalizedMessage.length < 10 || normalizedMessage.length > 2000) {
      throw new BadRequestException('Appeal details must be between 10 and 2000 characters.');
    }
    const request = await this.quoteRequestRepo.findLatestByUser(userId);
    if (!request) throw new NotFoundException('Enterprise quote request not found');
    if (request.status !== QuoteRequestStatus.SUSPENDED) {
      throw new BadRequestException('Only suspended Enterprise requests can be appealed');
    }
    if (request.appealStatus === 'PENDING') {
      throw new ConflictException('An appeal is already awaiting admin review');
    }
    const updated = await this.quoteRequestRepo.submitAppeal(request.id, normalizedMessage);
    if (!updated) throw new ConflictException('The appeal could not be submitted; refresh and try again');
    this.logger.log(`Enterprise suspension appeal submitted for quote ${request.id}`);
    return updated;
  }

  async resolveQuoteAppeal(
    user: AuthenticatedUser,
    quoteId: string,
    decision: 'APPROVED' | 'DECLINED',
    response?: string,
  ): Promise<QuoteRequestProps> {
    this.assertPlatformAdmin(user);
    this.assertQuoteId(quoteId);
    const normalizedResponse = response?.trim();
    if (normalizedResponse && normalizedResponse.length > 1000) {
      throw new BadRequestException('Admin response must be 1000 characters or fewer.');
    }
    const result = await this.withMongoTransaction(async (session) => {
      const request = await this.quoteRequestRepo.findById(quoteId, session);
      if (!request) throw new NotFoundException('Quote request not found');
      if (request.status !== QuoteRequestStatus.SUSPENDED || request.appealStatus !== 'PENDING') {
        throw new BadRequestException('This request has no pending appeal');
      }
      if (decision === 'APPROVED') {
        await this.applyQuoteRequestStatus(user, request, QuoteRequestStatus.APPROVED, undefined, session, false);
      }
      const updated = await this.quoteRequestRepo.resolveAppeal(quoteId, decision, normalizedResponse, session);
      if (!updated) throw new ConflictException('The appeal was already resolved; refresh the request');
      return { request, updated };
    });
    if (decision === 'APPROVED') {
      await this.appendBillingAudit({
        actorUserId: user.userId,
        organizationId: result.request.organizationId,
        action: `ENTERPRISE_QUOTE_${QuoteRequestStatus.APPROVED}`,
        resourceType: 'enterprise_quote_request',
        resourceId: quoteId,
        metadata: { previousStatus: QuoteRequestStatus.SUSPENDED, newStatus: QuoteRequestStatus.APPROVED, planTier: PlanTier.ENTERPRISE },
      });
    }
    await this.appendBillingAudit({
      actorUserId: user.userId,
      organizationId: result.request.organizationId,
      action: `ENTERPRISE_APPEAL_${decision}`,
      resourceType: 'enterprise_quote_request',
      resourceId: quoteId,
      metadata: { appealMessage: result.request.appealMessage ?? '', ...(normalizedResponse ? { response: normalizedResponse } : {}) },
    });
    return result.updated;
  }

  async listQuoteRequests(
    user: AuthenticatedUser,
    filters?: { status?: QuoteRequestStatus; page?: number; limit?: number },
  ): Promise<{ items: QuoteRequestProps[]; total: number }> {
    this.assertPlatformAdmin(user);
    if (filters?.page !== undefined && (!Number.isInteger(filters.page) || filters.page < 1)) {
      throw new BadRequestException('Page must be a positive integer.');
    }
    if (filters?.limit !== undefined && (!Number.isInteger(filters.limit) || filters.limit < 1 || filters.limit > 100)) {
      throw new BadRequestException('Limit must be an integer between 1 and 100.');
    }
    return this.quoteRequestRepo.findAll(filters, filters?.page, filters?.limit);
  }

  async updateQuoteRequestStatus(
    user: AuthenticatedUser,
    quoteId: string,
    newStatus: QuoteRequestStatus,
    reason?: string,
  ): Promise<QuoteRequestProps> {
    this.assertPlatformAdmin(user);
    this.assertQuoteId(quoteId);
    const normalizedReason = reason?.trim();
    if (newStatus === QuoteRequestStatus.SUSPENDED && !normalizedReason) {
      throw new BadRequestException('A policy violation reason is required to suspend Enterprise access');
    }
    const result = await this.withMongoTransaction(async (session) => {
      const request = await this.quoteRequestRepo.findById(quoteId, session);
      if (!request) throw new NotFoundException('Quote request not found');
      const updated = await this.applyQuoteRequestStatus(user, request, newStatus, normalizedReason, session);
      return { request, updated };
    });

    if (result.request.status === newStatus) return result.updated;
    await this.appendBillingAudit({
      actorUserId: user.userId,
      organizationId: result.request.organizationId,
      action: `ENTERPRISE_QUOTE_${newStatus}`,
      resourceType: 'enterprise_quote_request',
      resourceId: quoteId,
      metadata: {
        previousStatus: result.request.status,
        newStatus,
        ...(normalizedReason ? { reason: normalizedReason } : {}),
        ...(newStatus === QuoteRequestStatus.APPROVED ? { planTier: PlanTier.ENTERPRISE } : {}),
      },
    });
    if (
      result.request.status === QuoteRequestStatus.SUSPENDED &&
      result.request.appealStatus === 'PENDING' &&
      newStatus === QuoteRequestStatus.APPROVED
    ) {
      await this.appendBillingAudit({
        actorUserId: user.userId,
        organizationId: result.request.organizationId,
        action: 'ENTERPRISE_APPEAL_APPROVED',
        resourceType: 'enterprise_quote_request',
        resourceId: quoteId,
        metadata: { appealMessage: result.request.appealMessage ?? '', resolution: 'Enterprise access restored by admin' },
      });
    }

    this.logger.log(`Quote request ${quoteId} status updated to ${newStatus} by admin ${user.userId}`);
    return result.updated;
  }

  private async applyQuoteRequestStatus(
    user: AuthenticatedUser,
    request: QuoteRequestProps,
    newStatus: QuoteRequestStatus,
    reason: string | undefined,
    session: ClientSession,
    resolvePendingAppeal = true,
  ): Promise<QuoteRequestProps> {
    if (request.status === newStatus) {
      if (newStatus === QuoteRequestStatus.APPROVED) {
        await this.activateEnterpriseSubscription(request, session);
      }
      return request;
    }
    const allowedTransitions: Record<QuoteRequestStatus, QuoteRequestStatus[]> = {
      [QuoteRequestStatus.PENDING]: [QuoteRequestStatus.CONTACTED, QuoteRequestStatus.APPROVED, QuoteRequestStatus.REJECTED, QuoteRequestStatus.CLOSED],
      [QuoteRequestStatus.CONTACTED]: [QuoteRequestStatus.APPROVED, QuoteRequestStatus.REJECTED, QuoteRequestStatus.CLOSED],
      [QuoteRequestStatus.APPROVED]: [QuoteRequestStatus.SUSPENDED],
      [QuoteRequestStatus.SUSPENDED]: [QuoteRequestStatus.APPROVED],
      [QuoteRequestStatus.REJECTED]: [],
      [QuoteRequestStatus.CLOSED]: [],
    };
    if (!allowedTransitions[request.status]?.includes(newStatus)) {
      throw new BadRequestException(`Cannot transition quote request from ${request.status} to ${newStatus}`);
    }
    if (newStatus === QuoteRequestStatus.SUSPENDED) {
      if (!reason) throw new BadRequestException('A policy violation reason is required to suspend Enterprise access');
      await this.suspendEnterpriseSubscription(request, user.userId, reason, session);
    } else if (newStatus === QuoteRequestStatus.APPROVED) {
      if (request.status === QuoteRequestStatus.SUSPENDED) {
        await this.restoreEnterpriseSubscription(request, session);
      } else {
        await this.activateEnterpriseSubscription(request, session);
      }
    }
    let updated = await this.quoteRequestRepo.updateStatus(request.id, newStatus, reason, session, request.status);
    if (!updated) throw new ConflictException('The request changed while it was being processed. Refresh and try again.');
    if (resolvePendingAppeal && request.status === QuoteRequestStatus.SUSPENDED && newStatus === QuoteRequestStatus.APPROVED && request.appealStatus === 'PENDING') {
      updated = await this.quoteRequestRepo.resolveAppeal(request.id, 'APPROVED', undefined, session);
      if (!updated) throw new ConflictException('The appeal changed while access was being restored. Refresh and try again.');
    }
    return updated;
  }

  private async suspendEnterpriseSubscription(
    request: QuoteRequestProps,
    actorUserId: string,
    reason: string,
    session: ClientSession,
  ): Promise<void> {
    const subscription = await this.subscriptionRepo.findLatestByUser(request.userId, session);
    if (
      !subscription ||
      subscription.organizationId !== request.organizationId ||
      subscription.planTier !== PlanTier.ENTERPRISE
    ) {
      throw new BadRequestException('No Enterprise subscription is available to suspend');
    }
    if (subscription.status === SubscriptionStatus.SUSPENDED) return;
    if (subscription.status !== SubscriptionStatus.ACTIVE) {
      throw new BadRequestException('Only an active Enterprise subscription can be suspended');
    }

    const suspended = await this.subscriptionRepo.updateStatus(subscription.id, SubscriptionStatus.SUSPENDED, {
      reason,
      actorUserId,
    }, session);
    if (!suspended) throw new NotFoundException('Enterprise subscription not found');
  }

  private async restoreEnterpriseSubscription(request: QuoteRequestProps, session: ClientSession): Promise<void> {
    const subscription = await this.subscriptionRepo.findLatestByUser(request.userId, session);
    if (
      !subscription ||
      subscription.organizationId !== request.organizationId ||
      subscription.planTier !== PlanTier.ENTERPRISE
    ) {
      throw new BadRequestException('No suspended Enterprise subscription is available to restore');
    }
    if (subscription.status === SubscriptionStatus.ACTIVE) return;
    if (subscription.status !== SubscriptionStatus.SUSPENDED) {
      throw new BadRequestException('Enterprise subscription is not suspended');
    }
    const restored = await this.subscriptionRepo.updateStatus(subscription.id, SubscriptionStatus.ACTIVE, undefined, session);
    if (!restored) throw new NotFoundException('Enterprise subscription not found');
  }

  private async activateEnterpriseSubscription(request: QuoteRequestProps, session: ClientSession): Promise<void> {
    const existing = await this.subscriptionRepo.findActiveByUser(request.userId, session);
    if (
      existing?.organizationId === request.organizationId &&
      existing.planTier === PlanTier.ENTERPRISE &&
      existing.status === SubscriptionStatus.ACTIVE
    ) {
      return;
    }

    const now = new Date();
    const nextYear = new Date(now);
    nextYear.setFullYear(nextYear.getFullYear() + 1);
    const enterprisePlan = {
      planTier: PlanTier.ENTERPRISE,
      planName: 'Enterprise',
      billingCycle: BillingCycle.ANNUAL,
      status: SubscriptionStatus.ACTIVE,
      amountVnd: 0,
      currentPeriodStart: now,
      currentPeriodEnd: nextYear,
    };

    if (existing?.organizationId === request.organizationId) {
      const upgraded = await this.subscriptionRepo.updatePlan(existing.id, enterprisePlan, session);
      if (!upgraded) {
        throw new NotFoundException('Active subscription not found while approving Enterprise upgrade');
      }
      return;
    }

    await this.subscriptionRepo.create({
      userId: request.userId,
      organizationId: request.organizationId,
      ...enterprisePlan,
    }, session);
  }

  private assertPlatformAdmin(user: AuthenticatedUser): void {
    const isAdmin = Boolean(
      user.isPlatformAdmin ||
      (user as AuthenticatedUser & { roles?: string[]; role?: string }).roles?.includes('ADMIN') ||
      (user as AuthenticatedUser & { roles?: string[]; role?: string }).role === 'ADMIN',
    );
    if (!isAdmin) throw new ForbiddenException('Only platform admins can manage Enterprise quote requests.');
  }

  private assertQuoteId(quoteId: string): void {
    if (!/^[a-f\d]{24}$/i.test(quoteId)) throw new BadRequestException('Invalid Enterprise request ID.');
  }

  private async withMongoTransaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = await this.connection.startSession();
    try {
      let result: T | undefined;
      await session.withTransaction(async () => {
        result = await work(session);
      });
      if (result === undefined) throw new ServiceUnavailableException('The Enterprise request could not be completed. Please retry.');
      return result;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if ((error as { code?: number })?.code === 11000) {
        throw new ConflictException({ code: 'QUOTE_REQUEST_EXISTS', message: 'You already have an open Enterprise quote request.' });
      }
      this.logger.error('Enterprise billing transaction failed; changes were rolled back.');
      throw new ServiceUnavailableException('The Enterprise request could not be completed. Please retry.');
    } finally {
      await session.endSession();
    }
  }

  private async appendBillingAudit(event: Parameters<NonNullable<typeof this.audit>['append']>[0]): Promise<void> {
    try {
      await this.audit?.append(event);
    } catch {
      // The state transition has committed. Audit failure must not make the caller retry a completed operation.
      this.logger.error('Enterprise billing state was saved, but its audit event could not be recorded.');
    }
  }
}
