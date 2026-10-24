import { EMAIL_PORT, EmailPort } from '../../auth/domain/email.port';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { randomBytes, randomUUID } from 'node:crypto';
import { Lead, LeadDocument } from '../infrastructure/lead.schema';
import { User } from '../../users/infrastructure/user.schema';
import { AUDIT_REPOSITORY, AuditRepository } from '../../audit/domain/audit.repository';
import { LeadStatus } from '../domain/lead.types';
import { Optional } from '@nestjs/common';
import { Organization } from '../../organizations/infrastructure/organization.schema';
import { Project } from '../../projects/infrastructure/project.schema';
import { ConversionJob } from '../../conversions/infrastructure/conversion-job.schema';
import {
  SALES_PIPELINE_STAGES,
  SalesPipelineLead,
  SalesPipelineQuery,
  SalesPipelineStage,
  SalesPipelineView,
} from '../domain/sales-pipeline.types';
import { SalesReportPeriod } from '../presentation/sales-report-query.dto';

export interface CreateCrmLeadDto {
  contactName: string;
  company: string;
  email: string;
  phone?: string;
  source?: string;
  score?: number;
  notes?: string;
}

export interface LogCallDto {
  summary: string;
  durationMinutes?: number;
  outcome?: string;
  actionItems?: string;
  notes?: string;
}

export interface ScheduleDemoDto {
  title?: string;
  topic?: string;
  scheduledAt: string;
  description?: string;
  agenda?: string;
  notes?: string;
  durationMinutes?: number;
  attendees?: string[];
}

export interface SendQuoteDto {
  planName: string;
  projectScope?: string;
  amount: number;
  discountPercent?: number;
  discountReason?: string;
}

@Injectable()
export class SalesCrmService {
  private readonly logger = new Logger(SalesCrmService.name);

  constructor(
    @InjectModel(Lead.name) private readonly leadModel: Model<Lead>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
    @Optional() @InjectModel(Organization.name) private readonly orgModel?: Model<Organization>,
    @Optional() @InjectModel(Project.name) private readonly projectModel?: Model<Project>,
    @Optional() @InjectModel(ConversionJob.name) private readonly conversionJobModel?: Model<ConversionJob>,
    @Optional() @Inject(EMAIL_PORT) private readonly email?: EmailPort,
  ) {}

  async listLeads(
    organizationId?: string,
    query?: { stage?: string; search?: string },
  ) {
    const filter: FilterQuery<LeadDocument> = {};
    if (organizationId && Types.ObjectId.isValid(organizationId)) {
      filter.$or = [
        { organizationId: new Types.ObjectId(organizationId) },
        { source: 'CONVERSATION' },
        { sourceReference: { $regex: '^conv_' } },
      ];
    }
    if (query?.stage && query.stage !== 'ALL') {
      filter.stage = query.stage;
    }
    if (query?.search?.trim()) {
      const searchRegex = new RegExp(query.search.trim(), 'i');
      filter.$or = [
        { contactName: searchRegex },
        { company: searchRegex },
        { contactEmail: searchRegex },
        { title: searchRegex },
      ];
    }

    const docs = await this.leadModel
      .find(filter)
      .sort({ score: -1, createdAt: -1 })
      .exec();

    return docs.map((doc) => this.mapLead(doc));
  }

  async getSalesPipeline(query: SalesPipelineQuery = {}): Promise<SalesPipelineView> {
    if (query.organizationId && !Types.ObjectId.isValid(query.organizationId)) {
      throw new BadRequestException({
        code: 'INVALID_ORGANIZATION_ID',
        message: 'The organization ID is invalid.',
      });
    }

    const clauses: FilterQuery<LeadDocument>[] = [];
    if (query.organizationId) {
      clauses.push({
        $or: [
          { organizationId: new Types.ObjectId(query.organizationId) },
          { source: 'CONVERSATION' },
          { sourceReference: { $regex: '^conv_' } },
        ],
      } as FilterQuery<LeadDocument>);
    }
    if (query.stage && query.stage !== 'ALL') {
      const stageMatches: FilterQuery<LeadDocument>[] = [
        { stage: query.stage },
        { status: query.stage },
      ];
      if (query.stage === 'NEW') {
        stageMatches.push({ stage: { $exists: false }, status: LeadStatus.ASSIGNED });
      }
      if (query.stage === 'WON') {
        stageMatches.push({ stage: { $exists: false }, status: LeadStatus.CONVERTED });
      }
      clauses.push({ $or: stageMatches } as FilterQuery<LeadDocument>);
    }
    const search = query.search?.trim();
    if (search) {
      const safeSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const searchRegex = new RegExp(safeSearch, 'i');
      clauses.push({
        $or: [
          { contactName: searchRegex },
          { company: searchRegex },
          { companyName: searchRegex },
          { contactEmail: searchRegex },
          { title: searchRegex },
        ],
      } as FilterQuery<LeadDocument>);
    }

    const filter: FilterQuery<LeadDocument> = clauses.length > 0 ? { $and: clauses } : {};
    const records = await this.leadModel
      .find(filter)
      .select('_id id company companyName title contactName source stage status score dealValue estimatedValue currency assignedTo assignedToUserId assignedToName assignments lastContactAt lastContactedAt createdAt updatedAt')
      .sort({ score: -1, createdAt: -1 })
      .lean()
      .exec() as unknown as Array<Record<string, unknown>>;

    const assignedUserIds = Array.from(new Set(records
      .map((record) => this.pipelineAssigneeId(record))
      .filter((id): id is string => !!id && Types.ObjectId.isValid(id))));
    const users = assignedUserIds.length > 0
      ? await this.userModel
        .find({ _id: { $in: assignedUserIds.map((id) => new Types.ObjectId(id)) } })
        .select('_id fullName')
        .lean()
        .exec()
      : [];
    const namesByUserId = new Map(users.map((user) => [String(user._id), user.fullName]));

    const items = records.map((record) => this.mapPipelineLead(record, namesByUserId));
    const stageCounts = Object.fromEntries(
      SALES_PIPELINE_STAGES.map((stage) => [stage, 0]),
    ) as Record<SalesPipelineStage, number>;
    for (const item of items) stageCounts[item.stage] += 1;

    return { items, total: items.length, stageCounts, lastUpdated: new Date() };
  }

  private pipelineAssigneeId(record: Record<string, unknown>): string | undefined {
    const assignments = Array.isArray(record.assignments) ? record.assignments : [];
    const latestAssignment = assignments.length > 0 && typeof assignments[assignments.length - 1] === 'object'
      ? assignments[assignments.length - 1] as Record<string, unknown>
      : undefined;
    const assignedId = record.assignedToUserId ?? record.assignedTo ?? latestAssignment?.salespersonId;
    if (typeof assignedId === 'string') return assignedId;
    return assignedId instanceof Types.ObjectId ? assignedId.toString() : undefined;
  }

  private mapPipelineLead(
    record: Record<string, unknown>,
    namesByUserId: Map<string, string>,
  ): SalesPipelineLead {
    const stageValue = String(record.stage ?? record.status ?? '').trim().toUpperCase();
    const normalizedStage = stageValue === LeadStatus.ASSIGNED
      ? 'NEW'
      : stageValue === LeadStatus.CONVERTED
        ? 'WON'
        : stageValue;
    const stage = SALES_PIPELINE_STAGES.includes(normalizedStage as SalesPipelineStage)
      ? normalizedStage as SalesPipelineStage
      : 'UNMAPPED';
    const assignedToId = this.pipelineAssigneeId(record);
    const dealValue = this.pipelineNumber(record.dealValue ?? record.estimatedValue);

    return {
      id: typeof record.id === 'string' ? record.id : String(record._id ?? ''),
      company: this.pipelineText(record.company) ?? this.pipelineText(record.companyName) ?? this.pipelineText(record.title) ?? 'Unnamed company',
      contactName: this.pipelineText(record.contactName) ?? 'Contact not specified',
      source: this.pipelineText(record.source) ?? 'Other',
      stage,
      score: this.pipelineNumber(record.score),
      dealValue,
      currency: 'VND',
      assignedToName: this.pipelineText(record.assignedToName)
        ?? (assignedToId ? namesByUserId.get(assignedToId) : undefined),
      lastContactAt: this.pipelineDate(record.lastContactAt ?? record.lastContactedAt),
      createdAt: this.pipelineDate(record.createdAt),
      updatedAt: this.pipelineDate(record.updatedAt),
    };
  }

  private pipelineText(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private pipelineNumber(value: unknown): number | undefined {
    const normalized = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    return Number.isFinite(normalized) ? normalized : undefined;
  }

  private pipelineDate(value: unknown): Date | undefined {
    const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : undefined;
    return date && !Number.isNaN(date.getTime()) ? date : undefined;
  }

  async getLead(id: string) {
    const doc = await this.findLeadById(id);
    return this.mapLead(doc);
  }

  async createLead(
    userId: string,
    organizationId: string | undefined,
    dto: CreateCrmLeadDto,
  ) {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const existing = await this.leadModel.findOne({ contactEmail: normalizedEmail }).exec();
    if (existing) {
      throw new ConflictException({
        code: 'LEAD_EMAIL_EXISTS',
        message: `Lead with email '${normalizedEmail}' already exists`,
      });
    }

    const orgId = organizationId && Types.ObjectId.isValid(organizationId)
      ? new Types.ObjectId(organizationId)
      : new Types.ObjectId();

    const title = `${dto.company || dto.contactName} - Legacy Modernization`;
    const sourceRef = `crm_${Date.now()}_${randomBytes(4).toString('hex')}`;
    const initialAssignment = {
      id: randomUUID(),
      teamId: 'internal_sales_team',
      salespersonId: userId,
      startedAt: new Date(),
      actorUserId: userId,
      expectedRevision: 0,
    };

    const doc = await this.leadModel.create({
      status: LeadStatus.ASSIGNED,
      organizationId: orgId,
      title,
      sourceReference: sourceRef,
      contactEmail: normalizedEmail,
      contactName: dto.contactName,
      company: dto.company,
      phone: dto.phone,
      source: dto.source || 'Website',
      stage: 'NEW',
      score: dto.score ?? 50,
      notes: dto.notes,
      creationFingerprint: randomBytes(16).toString('hex'),
      revision: 0,
      assignments: [initialAssignment],
      interactions: [],
      demos: [],
      quotes: [],
      contracts: [],
      assignedTo: userId,
    });

    await this.audit.append({
      actorUserId: userId,
      organizationId: orgId.toString(),
      action: 'LEAD_CREATED',
      resourceType: 'LEAD',
      resourceId: doc.id,
      metadata: { contactEmail: normalizedEmail, company: dto.company },
    });

    return this.mapLead(doc);
  }

  async sendLeadEmail(
    userId: string,
    leadId: string,
    dto: { to?: string; subject: string; content: string },
  ) {
    const doc = await this.findLeadById(leadId);
    const recipient = dto.to?.trim() || doc.contactEmail;
    if (!recipient) {
      throw new BadRequestException({ code: 'RECIPIENT_EMAIL_MISSING', message: 'Lead has no email address.' });
    }

    let deliveryStatus: string = 'SENT';
    if (this.email) {
      try {
        const formattedHtml = `
          <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #17263A; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #E5EAF0; border-radius: 12px; background-color: #ffffff;">
            <div style="margin-bottom: 20px; border-bottom: 2px solid #0652CC; padding-bottom: 12px;">
              <h2 style="color: #0652CC; margin: 0; font-size: 20px;">ALSM Enterprise Platform</h2>
              <span style="font-size: 12px; color: #6B778C;">Modernization & Enterprise Solutions</span>
            </div>
            <div style="white-space: pre-line; font-size: 14px; color: #17263A; line-height: 1.7;">
${dto.content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}
            </div>
            <div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #E5EAF0; font-size: 11px; color: #8491A3;">
              <p style="margin: 0 0 4px 0;">Email này được gửi chính thức từ Hệ thống Quản trị ALSM Enterprise.</p>
              <p style="margin: 0;">&copy; 2026 ALSM Technology Solutions JSC. Tòa nhà Keangnam Landmark 72, Hà Nội.</p>
            </div>
          </div>
        `;

        const res = await this.email.send({
          to: recipient,
          subject: dto.subject,
          text: dto.content,
          html: formattedHtml,
        });
        deliveryStatus = res || 'SENT';
      } catch (err: any) {
        deliveryStatus = 'FAILED';
        throw new BadRequestException({
          code: 'EMAIL_SEND_FAILED',
          message: `Lỗi gửi email SMTP: ${err.message}`,
        });
      }
    }

    // Log the interaction into CRM history & activity timeline
    doc.interactions.push({
      id: randomUUID(),
      type: 'EMAIL' as any,
      summary: dto.subject,
      durationMinutes: 5,
      outcome: deliveryStatus,
      actionItems: 'Chờ khách hàng phản hồi thông tin pháp nhân doanh nghiệp',
      notes: dto.content,
      performedBy: userId,
      createdAt: new Date(),
    } as any);
    doc.lastContactAt = new Date();
    await doc.save();

    await this.audit.append({
      actorUserId: userId,
      organizationId: doc.organizationId?.toString(),
      action: 'LEAD_EMAIL_SENT',
      resourceType: 'LEAD',
      resourceId: doc.id,
      metadata: { recipient, subject: dto.subject, deliveryStatus },
    });

    return {
      success: true,
      recipient,
      deliveryStatus,
      timestamp: new Date().toISOString(),
    };
  }

  async updateLead(userId: string, leadId: string, dto: Record<string, any>) {
    const doc = await this.findLeadById(leadId);
    if (dto.company !== undefined) { doc.company = dto.company; doc.companyName = dto.company; }
    if (dto.contactName !== undefined) doc.contactName = dto.contactName;
    if (dto.email !== undefined) doc.contactEmail = dto.email;
    if (dto.contactEmail !== undefined) doc.contactEmail = dto.contactEmail;
    if (dto.phone !== undefined) doc.phone = dto.phone;
    if (dto.taxId !== undefined) doc.taxId = dto.taxId;
    if (dto.address !== undefined) doc.address = dto.address;
    if (dto.representativeName !== undefined) doc.representativeName = dto.representativeName;
    if (dto.representativeTitle !== undefined) doc.representativeTitle = dto.representativeTitle;
    if (dto.signatoryEmail !== undefined) doc.signatoryEmail = dto.signatoryEmail;
    if (dto.notes !== undefined) doc.notes = dto.notes;
    if (dto.dealValue !== undefined) doc.dealValue = dto.dealValue;
    if (dto.estimatedScreens !== undefined) doc.estimatedScreens = dto.estimatedScreens;
    if (dto.estimatedPrograms !== undefined) doc.estimatedPrograms = dto.estimatedPrograms;
    await doc.save();

    await this.audit.append({
      actorUserId: userId,
      organizationId: doc.organizationId?.toString(),
      action: 'LEAD_DETAILS_UPDATED',
      resourceType: 'LEAD',
      resourceId: doc.id,
      metadata: { ...dto },
    });

    return this.mapLead(doc);
  }

  async updateStage(
    userId: string,
    leadId: string,
    newStage: 'NEW' | 'CONTACTED' | 'QUALIFIED' | 'PROPOSAL' | 'NEGOTIATION' | 'WON' | 'LOST',
  ) {
    if (!['NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'].includes(newStage)) {
      throw new BadRequestException({ code: 'INVALID_LEAD_STAGE', message: 'Select a valid sales stage.' });
    }
    if (newStage === 'WON') {
      throw new BadRequestException({
        code: 'LEAD_ACTIVATION_REQUIRED',
        message: 'Convert the lead to a customer through Customer Activation to mark it Won.',
      });
    }
    const doc = await this.findLeadById(leadId);
    if (doc.stage === 'WON') {
      throw new ConflictException({
        code: 'LEAD_ALREADY_WON',
        message: 'A converted customer cannot be moved back through the lead-stage editor.',
      });
    }
    const oldStage = doc.stage;
    doc.stage = newStage;
    await doc.save();

    await this.audit.append({
      actorUserId: userId,
      organizationId: doc.organizationId?.toString(),
      action: 'LEAD_STAGE_UPDATED',
      resourceType: 'LEAD',
      resourceId: doc.id,
      metadata: { oldStage, newStage },
    });

    return this.mapLead(doc);
  }

  async logInteraction(userId: string, leadId: string, dto: LogCallDto) {
    const doc = await this.findLeadById(leadId);
    const interaction = {
      id: randomUUID(),
      type: 'CALL' as const,
      summary: dto.summary,
      durationMinutes: dto.durationMinutes || 15,
      outcome: dto.outcome,
      actionItems: dto.actionItems,
      notes: dto.notes,
      performedBy: userId,
      createdAt: new Date(),
    };

    doc.interactions.push(interaction);
    doc.lastContactAt = new Date();
    if (doc.stage === 'NEW') {
      doc.stage = 'CONTACTED';
    }
    await doc.save();

    await this.audit.append({
      actorUserId: userId,
      organizationId: doc.organizationId?.toString(),
      action: 'LEAD_CALL_LOGGED',
      resourceType: 'LEAD',
      resourceId: doc.id,
      metadata: { summary: dto.summary },
    });

    return this.mapLead(doc);
  }

  async scheduleDemo(userId: string, leadId: string, dto: ScheduleDemoDto) {
    const doc = await this.findLeadById(leadId);
    const meetCode = `${randomBytes(3).toString('hex')}-${randomBytes(4).toString('hex')}-${randomBytes(3).toString('hex')}`;
    const meetLink = `https://meet.google.com/${meetCode}`;

    const title = dto.topic?.trim() || dto.title?.trim() || 'Product Demo';
    const description = dto.description?.trim() || [dto.agenda, dto.notes].filter(Boolean).join('\n') || undefined;
    const durationMinutes = Number(dto.durationMinutes) || 45;
    const attendees = Array.isArray(dto.attendees) ? dto.attendees : [];

    const demo = {
      id: randomUUID(),
      title,
      scheduledAt: new Date(dto.scheduledAt),
      description,
      meetLink,
      durationMinutes,
      attendees,
      status: 'SCHEDULED' as const,
      scheduledBy: userId,
      createdAt: new Date(),
    };

    doc.demos.push(demo);
    doc.lastContactAt = new Date();
    if (doc.stage === 'NEW' || doc.stage === 'CONTACTED') {
      doc.stage = 'QUALIFIED';
    }
    await doc.save();

    await this.audit.append({
      actorUserId: userId,
      organizationId: doc.organizationId?.toString(),
      action: 'LEAD_DEMO_SCHEDULED',
      resourceType: 'LEAD',
      resourceId: doc.id,
      metadata: { title, meetLink },
    });

    return this.mapLead(doc);
  }

  async sendQuote(userId: string, leadId: string, dto: SendQuoteDto, organizationId?: string) {
    if (!dto.planName?.trim()) {
      throw new BadRequestException({ code: 'INVALID_PLAN_NAME', message: 'Plan name cannot be empty.' });
    }
    if (!Number.isSafeInteger(dto.amount) || dto.amount <= 0) {
      throw new BadRequestException({ code: 'INVALID_AMOUNT', message: 'Quote amount must be a positive whole VND amount.' });
    }
    const discount = dto.discountPercent ?? 0;
    if (!Number.isFinite(discount) || discount < 0 || discount > 100) {
      throw new BadRequestException({ code: 'INVALID_DISCOUNT', message: 'Discount must be between 0 and 100 percent.' });
    }
    const discountReason = dto.discountReason?.trim() || undefined;
    if (discount >= 15 && !discountReason) {
      throw new BadRequestException({ code: 'DISCOUNT_REASON_REQUIRED', message: 'Discounts of 15% or more require a justification.' });
    }
    const doc = await this.findLeadById(leadId, organizationId);
    const requiresApproval = discount >= 15;
    const quoteStatus = requiresApproval ? 'PENDING_APPROVAL' : 'SENT';

    const quote = {
      id: randomUUID(),
      planName: dto.planName.trim(),
      projectScope: dto.projectScope?.trim() || undefined,
      amount: dto.amount,
      finalPrice: Math.round(dto.amount * (1 - discount / 100)),
      discountPercent: discount,
      discountApproved: !requiresApproval,
      discountReason,
      status: (requiresApproval ? 'PENDING_APPROVAL' : 'SENT') as 'DRAFT' | 'PENDING_APPROVAL' | 'SENT' | 'ACCEPTED' | 'REJECTED',
      sentAt: requiresApproval ? undefined : new Date(),
      pdfUrl: `/quotes/quote-${Date.now()}.pdf`,
      createdAt: new Date(),
    };

    doc.quotes.push(quote);
    if (doc.stage !== 'PROPOSAL' && doc.stage !== 'WON') {
      doc.stage = 'PROPOSAL';
    }
    await doc.save();

    await this.audit.append({
      actorUserId: userId,
      organizationId: doc.organizationId?.toString(),
      action: 'LEAD_QUOTE_CREATED',
      resourceType: 'LEAD',
      resourceId: doc.id,
      metadata: { planName: dto.planName, amount: String(dto.amount), status: quoteStatus },
    });

    return this.mapLead(doc);
  }

  async signContract(_userId: string, _leadId: string, _contractId: string) {
    void _userId;
    void _leadId;
    void _contractId;
    throw new ConflictException({
      code: 'REAL_SIGNING_NOT_CONFIGURED',
      message: 'This legacy signature simulation is disabled. A verified signing provider must confirm the customer signature.',
    });
  }

  async sendContractForSignature(_userId: string, _leadId: string, _contractId: string) {
    void _userId;
    void _leadId;
    void _contractId;
    throw new ConflictException({
      code: 'SIGNING_PROVIDER_NOT_CONFIGURED',
      message: 'Contract signature dispatch is unavailable until an approved signing provider is configured.',
    });
  }

  // Section 3.12: Sales Reports & Approvals
  private computeLeadContractRevenue(lead: any): number {
    // Realised revenue strictly comes from WON deals with signed contracts
    if (lead.stage !== 'WON') {
      return 0;
    }

    // 1. Check contracts array for FULLY_SIGNED or SIGNED contracts
    const signedContracts = (lead.contracts || []).filter(
      (c: any) => c.status === 'FULLY_SIGNED' || c.status === 'SIGNED',
    );
    if (signedContracts.length > 0) {
      const contractTotal = signedContracts.reduce(
        (sum: number, c: any) => sum + (c.annualValue || 0),
        0,
      );
      if (contractTotal > 0) return contractTotal;
    }

    // 2. Closed WON deals fallback (verified payment or agreed contract dealValue)
    if (lead.payment?.status === 'CONFIRMED' && typeof lead.payment?.amount === 'number') {
      return lead.payment.amount;
    }
    if (typeof lead.dealValue === 'number' && lead.dealValue > 0) {
      return lead.dealValue;
    }
    const acceptedQuote = (lead.quotes || []).find((q: any) => q.status === 'ACCEPTED');
    if (acceptedQuote) {
      return acceptedQuote.finalPrice || acceptedQuote.amount || 0;
    }

    return 0;
  }

  async getSalesReports(organizationId?: string, period: SalesReportPeriod = 'ALL') {
    const filter: FilterQuery<LeadDocument> = {};
    if (organizationId) {
      if (!Types.ObjectId.isValid(organizationId)) {
        throw new BadRequestException({ code: 'INVALID_ORGANIZATION_ID', message: 'The organization ID is invalid.' });
      }
      filter.organizationId = new Types.ObjectId(organizationId);
    }
    const start = this.salesReportStart(period);
    if (start) filter.createdAt = { $gte: start };
    const leads = await this.leadModel.find(filter).exec();
    const totalLeads = leads.length;
    const wonLeads = leads.filter((l) => l.stage === 'WON').length;
    const conversionRate = totalLeads > 0 ? Math.round((wonLeads / totalLeads) * 100) : 0;

    const pipelineBreakdown = {
      NEW: leads.filter((l) => l.stage === 'NEW').length,
      CONTACTED: leads.filter((l) => l.stage === 'CONTACTED').length,
      QUALIFIED: leads.filter((l) => l.stage === 'QUALIFIED').length,
      PROPOSAL: leads.filter((l) => l.stage === 'PROPOSAL').length,
      WON: wonLeads,
      LOST: leads.filter((l) => l.stage === 'LOST').length,
    };

    const leadSources = leads.reduce((acc, lead) => {
      const src = lead.source || 'Website';
      acc[src] = (acc[src] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Realised revenue strictly from signed contracts & confirmed WON deals
    const totalRevenue = leads.reduce((sum, lead) => sum + this.computeLeadContractRevenue(lead), 0);
    const avgDealSize = wonLeads > 0 ? Math.round(totalRevenue / wonLeads) : 0;

    return {
      totalLeads,
      wonLeads,
      conversionRate,
      monthlyRevenue: totalRevenue,
      totalRevenue,
      averageDealSize: avgDealSize,
      avgDealSize,
      stageDistribution: pipelineBreakdown,
      pipelineBreakdown,
      sourceDistribution: leadSources,
      leadSources,
      organizationId,
      period,
      lastUpdated: new Date().toISOString(),
    };
  }

  async exportSalesReportsCsv(organizationId?: string, period: SalesReportPeriod = 'ALL') {
    const filter: FilterQuery<LeadDocument> = {};
    if (organizationId) {
      if (!Types.ObjectId.isValid(organizationId)) {
        throw new BadRequestException({ code: 'INVALID_ORGANIZATION_ID', message: 'The organization ID is invalid.' });
      }
      filter.organizationId = new Types.ObjectId(organizationId);
    }
    const start = this.salesReportStart(period);
    if (start) filter.createdAt = { $gte: start };
    const leads = await this.leadModel.find(filter).sort({ createdAt: -1 }).exec();
    const headers = 'ID,Company,Contact,Email,Phone,Source,Stage,Score,LastContactAt,Created\n';
    const rows = leads.map((l) => {
      const createdAtStr = l.createdAt ? new Date(l.createdAt).toISOString() : '';
      return `"${l.id}","${l.company || ''}","${l.contactName || ''}","${l.contactEmail || ''}","${l.phone || ''}","${l.source || ''}","${l.stage}","${l.score}","${l.lastContactAt ? l.lastContactAt.toISOString() : ''}","${createdAtStr}"`;
    });
    return headers + rows.join('\n');
  }

  async getTeamPerformance(filters?: {
    dateRange?: string;
    teamMember?: string;
    region?: string;
  }) {
    const filter: FilterQuery<LeadDocument> = {};
    const start = this.salesReportStart((filters?.dateRange as SalesReportPeriod) || 'ALL');
    if (start) filter.createdAt = { $gte: start };

    const leads = await this.leadModel.find(filter).exec();

    // Dynamically retrieve sales and administrative staff from userModel
    let systemUsers: any[] = [];
    try {
      systemUsers = await this.userModel.find({}).select('_id fullName email roles isPlatformAdmin').exec();
    } catch {
      // fallback if userModel query fails
    }

    const repsMap = new Map<string, { id: string; name: string; email: string; region: string; avgResponse: number }>();

    // 1. Add all users who have an account in the platform
    for (const u of systemUsers) {
      const email = (u.email || '').trim().toLowerCase();
      if (!email) continue;
      const name = u.fullName || email.split('@')[0] || 'Sales Rep';
      repsMap.set(email, {
        id: u._id.toString(),
        name,
        email: u.email,
        region: 'North America',
        avgResponse: 2.1,
      });
    }

    // 2. Discover any additional representatives assigned on actual leads
    for (const l of leads) {
      const email = (l.assignedTo || '').trim().toLowerCase();
      const name = (l.assignedToName || l.assignedTo || '').trim();
      if (email && !repsMap.has(email)) {
        repsMap.set(email, {
          id: l.assignedToUserId ? l.assignedToUserId.toString() : `rep-${name.toLowerCase().replace(/\s+/g, '-')}`,
          name: name || email.split('@')[0],
          email: l.assignedTo || email,
          region: 'APAC',
          avgResponse: 2.0,
        });
      } else if (name && !email) {
        const key = name.toLowerCase();
        if (!repsMap.has(key)) {
          repsMap.set(key, {
            id: l.assignedToUserId ? l.assignedToUserId.toString() : `rep-${key.replace(/\s+/g, '-')}`,
            name,
            email: `${key.replace(/\s+/g, '.')}@alsm.io`,
            region: 'EMEA',
            avgResponse: 2.2,
          });
        }
      }
    }

    // 3. Fallback to default representatives if no reps exist yet
    if (repsMap.size === 0) {
      repsMap.set('sarah.jenkins@alsm.io', { id: 'rep-sarah', name: 'Sarah Jenkins', email: 'sarah.jenkins@alsm.io', region: 'North America', avgResponse: 1.8 });
      repsMap.set('david.nguyen@alsm.io', { id: 'rep-david', name: 'David Nguyen', email: 'david.nguyen@alsm.io', region: 'EMEA', avgResponse: 2.4 });
      repsMap.set('elena.rostova@alsm.io', { id: 'rep-elena', name: 'Elena Rostova', email: 'elena.rostova@alsm.io', region: 'APAC', avgResponse: 2.1 });
    }

    let filteredReps = Array.from(repsMap.values());
    if (filters?.teamMember && filters.teamMember !== 'ALL') {
      filteredReps = filteredReps.filter(
        (r) =>
          r.name.toLowerCase() === filters.teamMember?.toLowerCase() ||
          r.email.toLowerCase() === filters.teamMember?.toLowerCase()
      );
    }
    if (filters?.region && filters.region !== 'ALL') {
      filteredReps = filteredReps.filter((r) => r.region.toLowerCase() === filters.region?.toLowerCase());
    }

    const rawMembers = filteredReps.map((rep) => {
      const repLeads = leads.filter((l) => {
        const lEmail = (l.assignedTo || '').toLowerCase();
        const lName = (l.assignedToName || l.assignedTo || '').toLowerCase();
        const rEmail = rep.email.toLowerCase();
        const rName = rep.name.toLowerCase();
        return (
          lEmail === rEmail ||
          lName === rName ||
          (l.assignedToUserId && l.assignedToUserId.toString() === rep.id)
        );
      });

      const leadsAssigned = repLeads.length;
      const qualifiedLeads = repLeads.filter((l) =>
        ['QUALIFIED', 'PROPOSAL', 'WON'].includes(l.stage),
      ).length;
      const wonDeals = repLeads.filter((l) => l.stage === 'WON').length;
      const revenue = repLeads.reduce((sum, l) => sum + this.computeLeadContractRevenue(l), 0);
      const conversionRate = leadsAssigned > 0 ? Math.round((wonDeals / leadsAssigned) * 100) : 0;
      const avgDeal = wonDeals > 0 ? Math.round(revenue / wonDeals) : revenue > 0 ? revenue : 0;

      return {
        repId: rep.id,
        repName: rep.name,
        repEmail: rep.email,
        region: rep.region,
        leadsAssigned,
        qualifiedLeads,
        wonDeals,
        conversionRate,
        revenueGenerated: revenue,
        averageDealSize: avgDeal,
        avgResponseHours: rep.avgResponse,
        avgResponseTimeHours: rep.avgResponse,
      };
    });

    const totalLeads = rawMembers.reduce((sum, m) => sum + m.leadsAssigned, 0);
    const totalWon = rawMembers.reduce((sum, m) => sum + m.wonDeals, 0);
    const totalRev = rawMembers.reduce((sum, m) => sum + m.revenueGenerated, 0);
    const avgDealSize = totalWon > 0 ? Math.round(totalRev / totalWon) : 0;
    const teamConversionRate = totalLeads > 0 ? Math.round((totalWon / totalLeads) * 100) : 0;
    const avgResponseTime =
      rawMembers.length > 0
        ? Number((rawMembers.reduce((sum, m) => sum + m.avgResponseHours, 0) / rawMembers.length).toFixed(1))
        : 2.1;

    const members = rawMembers.map((m) => ({
      ...m,
      diffFromTeamAvgPercent: m.conversionRate - teamConversionRate,
    }));

    return {
      teamName: 'Enterprise Modernization Commercial Team',
      managerId: 'usr-mgr-current',
      managerName: 'Commercial Operations Team',
      periodDays: filters?.dateRange === '30D' ? 30 : filters?.dateRange === '90D' ? 90 : 365,
      teamTotalLeads: totalLeads,
      teamWonDeals: totalWon,
      teamConversionRate,
      teamTotalRevenue: totalRev,
      teamAvgDealSize: avgDealSize,
      teamAvgResponseTimeHours: avgResponseTime,
      members,
    };
  }

  private salesReportStart(period: SalesReportPeriod): Date | undefined {
    const now = new Date();
    if (period === '30D' || period === '90D') {
      const start = new Date(now);
      start.setUTCDate(start.getUTCDate() - (period === '30D' ? 30 : 90));
      return start;
    }
    if (period === 'YTD') return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    return undefined;
  }

  async getDiscountRequests(organizationId?: string) {
    let leads: LeadDocument[] = [];
    if (organizationId && Types.ObjectId.isValid(organizationId)) {
      leads = await this.leadModel.find({
        organizationId: new Types.ObjectId(organizationId),
        'quotes.discountPercent': { $gt: 0 },
      }).sort({ createdAt: -1 }).exec();
    }
    // If no discount requests found in specific organization, fetch across all leads for manager visibility
    if (!leads || leads.length === 0) {
      leads = await this.leadModel.find({
        'quotes.discountPercent': { $gt: 0 },
      }).sort({ createdAt: -1 }).exec();
    }
    return leads.flatMap((lead) => (lead.quotes || [])
      .filter((quote) => Number(quote.discountPercent ?? 0) > 0)
      .map((quote) => {
        const amount = Number(quote.amount ?? 0);
        const discountPercent = Number(quote.discountPercent ?? 0);
        const finalPrice = Number(quote.finalPrice ?? Math.round(amount * (1 - discountPercent / 100)));
        const discountAmount = amount - finalPrice;
        const status = quote.status === 'SENT' && quote.discountApproved
          ? 'APPROVED'
          : quote.status === 'REJECTED'
            ? 'REJECTED'
            : quote.approvalStatus === 'REQUIRES_HIGHER_APPROVAL'
              ? 'REQUIRES_HIGHER_APPROVAL'
              : 'PENDING';
        const submittedAt = quote.createdAt instanceof Date
          ? quote.createdAt.toISOString()
          : new Date(quote.createdAt).toISOString();
        const publicQuote = {
          id: quote.id,
          quoteNumber: quote.id,
          plan: quote.planName,
          projectScope: quote.projectScope,
          basePrice: amount,
          discountPercent,
          finalPrice,
          requiresApproval: true,
          approvalStatus: status,
          discountReason: quote.discountReason,
          status: quote.status === 'PENDING_APPROVAL' ? 'DRAFT' : quote.status,
          discountApproved: quote.discountApproved,
          approvedBy: quote.approvedBy,
          approvedAt: quote.approvedAt,
          rejectionReason: quote.rejectionReason,
          escalatedBy: quote.escalatedBy,
          escalatedAt: quote.escalatedAt,
          executiveReviewedBy: quote.executiveReviewedBy,
          executiveReviewedAt: quote.executiveReviewedAt,
          sentAt: quote.sentAt,
          createdAt: submittedAt,
        };
        return {
          requestId: quote.id,
          leadId: lead.id,
          leadCompany: lead.company || lead.companyName || lead.title,
          leadContact: lead.contactName || '',
          assignedTo: lead.assignedTo,
          assignedToName: lead.assignedToName || lead.assignedTo || 'Unassigned',
          quote: publicQuote,
          quoteId: quote.id,
          quoteNumber: quote.id,
          originalPrice: amount,
          discountPercent,
          discountAmount,
          proposedFinalPrice: amount - discountAmount,
          justification: quote.discountReason,
          submittedAt,
          status,
          requiresHigherApproval: status === 'REQUIRES_HIGHER_APPROVAL',
          managerLimitPercent: 20,
          rejectionReason: quote.rejectionReason,
          reviewedBy: quote.approvedBy,
          reviewedAt: quote.approvedAt instanceof Date ? quote.approvedAt.toISOString() : quote.approvedAt,
          escalatedBy: quote.escalatedBy,
          escalatedAt: quote.escalatedAt instanceof Date ? quote.escalatedAt.toISOString() : quote.escalatedAt,
          executiveReviewedBy: quote.executiveReviewedBy,
          executiveReviewedAt: quote.executiveReviewedAt instanceof Date ? quote.executiveReviewedAt.toISOString() : quote.executiveReviewedAt,
        };
      }));
  }

  private async findLeadById(id: string, organizationId?: string) {
    let doc: LeadDocument | null = null;
    if (Types.ObjectId.isValid(id)) {
      doc = organizationId && Types.ObjectId.isValid(organizationId)
        ? await this.leadModel.findOne({ _id: new Types.ObjectId(id), organizationId: new Types.ObjectId(organizationId) }).exec()
        : await this.leadModel.findById(id).exec();
    }
    if (!doc) {
      doc = await this.leadModel.findOne({ id, ...(organizationId && Types.ObjectId.isValid(organizationId)
        ? { organizationId: new Types.ObjectId(organizationId) }
        : {}) }).exec();
    }
    if (!doc) {
      try {
        doc = await this.leadModel.findById(id)?.exec?.();
      } catch {
        // ignore cast error
      }
    }
    if (!doc) {
      throw new NotFoundException({ code: 'LEAD_NOT_FOUND', message: `Lead '${id}' was not found` });
    }
    return doc;
  }

  mapLead(doc: LeadDocument) {
    const company = [doc.company, doc.companyName].find(
      (value) => typeof value === 'string' && value.trim().length > 0,
    ) ?? (
      typeof doc.title === 'string' &&
      doc.title.trim().length > 0 &&
      !/^[a-f\d]{24}$/i.test(doc.title.trim())
        ? doc.title.trim()
        : undefined
    ) ?? (
      typeof doc.contactName === 'string' && doc.contactName.trim().length > 0
        ? doc.contactName.trim()
        : 'Unnamed company'
    );
    return {
      id: doc.id || doc._id.toString(),
      organizationId: doc.organizationId?.toString(),
      title: doc.title,
      contactName: doc.contactName,
      company,
      email: doc.contactEmail,
      contactEmail: doc.contactEmail,
      phone: doc.phone,
        taxId: doc.taxId,
        address: doc.address,
        representativeName: doc.representativeName,
        representativeTitle: doc.representativeTitle,
        signatoryEmail: doc.signatoryEmail,
      source: doc.source,
      stage: doc.stage || 'NEW',
      score: doc.score ?? 50,
      lastContactAt: doc.lastContactAt,
      notes: doc.notes,
      assignedTo: doc.assignedTo,
      conversationId: doc.conversationId?.toString(),
      priority: doc.priority || 'MEDIUM',
      estimatedScreens: doc.estimatedScreens || 0,
      estimatedPrograms: doc.estimatedPrograms || 0,
      dealValue: doc.dealValue ?? doc.estimatedValue ?? 0,
      estimatedValue: doc.estimatedValue ?? doc.dealValue ?? 0,
      expectedCloseDate: doc.expectedCloseDate,
      followUpDate: doc.followUpDate,
      businessRequirements: doc.businessRequirements,
      convertedAt: doc.convertedAt,
      convertedOrganizationId: doc.convertedOrganizationId?.toString(),
      provisioning: doc.provisioning,
      interactions: doc.interactions || [],
      demos: doc.demos || [],
      quotes: doc.quotes || [],
      contracts: (doc.contracts || []).map((contract) => {
        const {
          requestId: _requestId,
          requestFingerprint: _requestFingerprint,
          createdByUserId: _createdByUserId,
          ...publicContract
        } = contract as Record<string, unknown>;
        void _requestId;
        void _requestFingerprint;
        void _createdByUserId;
        return publicContract;
      }),
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  async listAllQuotes(
    organizationId?: string,
    query?: { status?: string; search?: string; serviceType?: string },
  ) {
    const filter: FilterQuery<LeadDocument> = {};
    if (organizationId && Types.ObjectId.isValid(organizationId)) {
      filter.organizationId = new Types.ObjectId(organizationId);
    }
    const leads = await this.leadModel.find(filter).sort({ updatedAt: -1 }).exec();
    const allQuotes: any[] = [];

    for (const lead of leads) {
      const company = lead.company || lead.companyName || 'Enterprise Prospect';
      const contactName = lead.contactName || 'Valued Customer';
      const email = lead.contactEmail || '';
      for (const q of (lead.quotes || []) as any[]) {
        const quoteObj = {
          id: q.id,
          quoteNumber: q.quoteNumber || `QTE-${q.id.slice(0, 8).toUpperCase()}`,
          leadId: lead._id.toString(),
          customerName: contactName,
          companyName: company,
          customerEmail: email,
          customerPhone: lead.phone,
          serviceType: q.serviceType || (q.planName?.toLowerCase().includes('managed') ? 'ALSM_MANAGED' : 'CUSTOMER_SELF_SERVICE'),
          servicePackage: q.servicePackage || q.planName || 'Enterprise',
          capacityConfig: q.capacityConfig || {
            screenCapacity: 50,
            programCapacity: 20,
            projectCapacity: 10,
            userSeats: 10,
            concurrentLimit: 3,
            storageGb: 20,
            legacyTypes: ['AS400', 'COBOL', 'VB6'],
          },
          durationMonths: q.durationMonths || 12,
          startDate: q.startDate || (q.createdAt ? new Date(q.createdAt).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10)),
          endDate: q.endDate,
          autoRenewal: q.autoRenewal ?? true,
          amount: q.amount,
          finalPrice: q.finalPrice || q.amount,
          discountPercent: q.discountPercent || 0,
          discountReason: q.discountReason,
          discountApproved: q.discountApproved,
          approvalStatus: q.approvalStatus || (q.discountPercent && q.discountPercent >= 15 ? 'PENDING' : 'APPROVED'),
          paymentTerms: q.paymentTerms || 'FULL',
          additionalServices: q.additionalServices || [],
          status: q.status || 'SENT',
          salesOwner: q.salesOwner || lead.assignedToName || 'Commercial Sales Rep',
          validUntil: q.validUntil || (q.createdAt ? new Date(new Date(q.createdAt).getTime() + 30 * 86400000) : new Date(Date.now() + 30 * 86400000)),
          createdAt: q.createdAt,
          contractId: q.contractId,
          contractNumber: q.contractNumber,
        };

        if (query?.status && query.status !== 'ALL' && quoteObj.status !== query.status) {
          continue;
        }
        if (query?.serviceType && query.serviceType !== 'ALL' && quoteObj.serviceType !== query.serviceType) {
          continue;
        }
        if (query?.search?.trim()) {
          const s = query.search.trim().toLowerCase();
          const match =
            quoteObj.quoteNumber.toLowerCase().includes(s) ||
            quoteObj.companyName.toLowerCase().includes(s) ||
            quoteObj.customerName.toLowerCase().includes(s) ||
            quoteObj.servicePackage.toLowerCase().includes(s);
          if (!match) continue;
        }
        allQuotes.push(quoteObj);
      }
    }

    allQuotes.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return allQuotes;
  }

  async createEnterpriseQuote(
    userId: string,
    organizationId: string | undefined,
    dto: any,
  ) {
    let lead: LeadDocument | null = null;
    if (dto.leadId && Types.ObjectId.isValid(dto.leadId)) {
      lead = await this.leadModel.findById(dto.leadId).exec();
    }
    if (!lead && dto.customerEmail?.trim()) {
      lead = await this.leadModel.findOne({ contactEmail: dto.customerEmail.trim().toLowerCase() }).exec();
    }
    if (!lead) {
      const orgId = organizationId && Types.ObjectId.isValid(organizationId)
        ? new Types.ObjectId(organizationId)
        : new Types.ObjectId();
      const newLead = new this.leadModel({
        title: `${dto.companyName || dto.customerName} - Modernization Quote`,
        sourceReference: `QUOTE-${Date.now()}-${randomBytes(4).toString('hex')}`,
        organizationId: orgId,
        status: LeadStatus.ASSIGNED,
        stage: 'PROPOSAL',
        contactName: dto.customerName,
        company: dto.companyName,
        companyName: dto.companyName,
        contactEmail: dto.customerEmail?.trim().toLowerCase(),
        phone: dto.customerPhone,
        score: 65,
        creationFingerprint: randomUUID(),
        revision: 1,
        assignments: [{
          teamId: 'commercial-team',
          startedAt: new Date(),
          reassignedBy: userId,
        }],
        assignedTo: 'Sales Specialist',
        assignedToName: 'Sales Specialist',
        quotes: [],
        contracts: [],
      });
      lead = await newLead.save();
    }

    const baseFee = Number(dto.baseFee) || 0;
    const capacityFee = Number(dto.capacityFee) || 0;
    const setupFee = Number(dto.setupFee) || 0;
    const additionalServicesFee = Number(dto.additionalServicesFee) || 0;
    const subtotal = baseFee + capacityFee + setupFee + additionalServicesFee;
    const discountPercent = Math.min(100, Math.max(0, Number(dto.discountPercent) || 0));
    const discountAmount = Math.round(subtotal * (discountPercent / 100));
    const afterDiscount = subtotal - discountAmount;
    const taxRate = Number(dto.taxRatePercent ?? 10) / 100;
    const taxAmount = Math.round(afterDiscount * taxRate);
    const totalAmount = afterDiscount + taxAmount;

    const requiresApproval = discountPercent >= 15;
    const requiresExecutive = discountPercent >= 30;
    const quoteStatus = requiresApproval ? 'PENDING_APPROVAL' : 'SENT';
    const approvalStatus = requiresApproval
      ? (requiresExecutive ? 'REQUIRES_HIGHER_APPROVAL' : 'PENDING')
      : 'APPROVED';

    const quoteId = randomUUID();
    const quoteNumber = `QTE-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

    const quoteRecord = {
      id: quoteId,
      quoteNumber,
      planName: dto.servicePackage || 'Enterprise',
      servicePackage: dto.servicePackage || 'Enterprise',
      serviceType: dto.serviceType || 'ALSM_MANAGED',
      capacityConfig: dto.capacityConfig || {
        screenCapacity: 50,
        programCapacity: 20,
        projectCapacity: 10,
        userSeats: 10,
        concurrentLimit: 3,
        storageGb: 20,
        legacyTypes: ['AS400', 'COBOL', 'VB6'],
      },
      durationMonths: dto.durationMonths || 12,
      startDate: dto.startDate || new Date().toISOString().slice(0, 10),
      endDate: dto.endDate,
      autoRenewal: dto.autoRenewal ?? true,
      amount: subtotal,
      finalPrice: totalAmount,
      discountPercent,
      discountApproved: !requiresApproval,
      discountReason: dto.discountReason?.trim() || undefined,
      approvalStatus,
      status: quoteStatus as any,
      paymentTerms: dto.paymentTerms || 'FULL',
      additionalServices: dto.additionalServices || [],
      salesOwner: 'Sales Specialist',
      validUntil: new Date(Date.now() + 30 * 86400000),
      createdAt: new Date(),
    };

    lead.quotes.push(quoteRecord as any);
    if (lead.stage !== 'PROPOSAL' && lead.stage !== 'WON') {
      lead.stage = 'PROPOSAL';
    }
    await lead.save();

    await this.audit.append({
      actorUserId: userId,
      organizationId: lead.organizationId?.toString(),
      action: 'ENTERPRISE_QUOTE_CREATED',
      resourceType: 'QUOTE',
      resourceId: quoteId,
      metadata: {
        quoteNumber,
        company: dto.companyName,
        totalAmount: String(totalAmount),
        discountPercent: String(discountPercent),
        requiresApproval: String(requiresApproval),
      },
    });

    return {
      success: true,
      quote: {
        ...quoteRecord,
        leadId: lead._id.toString(),
        companyName: lead.company || lead.companyName,
        customerName: lead.contactName,
        customerEmail: lead.contactEmail,
      },
    };
  }

  async convertQuoteToContract(userId: string, quoteId: string) {
    const lead = await this.leadModel.findOne({ 'quotes.id': quoteId }).exec();
    if (!lead) {
      throw new NotFoundException({ code: 'QUOTE_NOT_FOUND', message: 'The specified quote could not be found.' });
    }
    const quote = (lead.quotes || []).find((q: any) => q.id === quoteId) as any;
    if (!quote) {
      throw new NotFoundException({ code: 'QUOTE_NOT_FOUND', message: 'Quote not found in lead record.' });
    }
    if (quote.status === ('CONVERTED_TO_CONTRACT' as any)) {
      throw new ConflictException({ code: 'ALREADY_CONVERTED', message: 'This quote has already been converted to a contract.' });
    }
    if (quote.discountPercent && quote.discountPercent >= 15 && !quote.discountApproved) {
      throw new BadRequestException({ code: 'DISCOUNT_APPROVAL_REQUIRED', message: 'This quote has a pending discount and must be approved before conversion.' });
    }

    const contractId = randomUUID();
    const contractNumber = `CTR-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const effectiveDate = quote.startDate || new Date().toISOString().slice(0, 10);

    const contractRecord = {
      id: contractId,
      contractNumber,
      quoteId: quote.id,
      title: `${quote.servicePackage || quote.planName || 'Enterprise'} Agreement - ${lead.company || lead.companyName || lead.contactName}`,
      documentTitle: `${quote.servicePackage || quote.planName || 'Enterprise'} Agreement`,
      plan: quote.servicePackage || quote.planName || 'Enterprise',
      annualValue: quote.finalPrice || quote.amount,
      status: 'DRAFT' as const,
      effectiveDate,
      createdByUserId: userId,
      createdAt: new Date(),
    };

    lead.contracts.push(contractRecord as any);
    quote.status = 'CONVERTED_TO_CONTRACT' as any;
    quote.contractId = contractId;
    quote.contractNumber = contractNumber;
    if (lead.stage !== 'WON') {
      lead.stage = 'PROPOSAL';
    }
    await lead.save();

    await this.audit.append({
      actorUserId: userId,
      organizationId: lead.organizationId?.toString(),
      action: 'QUOTE_CONVERTED_TO_CONTRACT',
      resourceType: 'CONTRACT',
      resourceId: contractId,
      metadata: {
        quoteId,
        quoteNumber: quote.quoteNumber || '',
        contractNumber,
        annualValue: String(contractRecord.annualValue),
      },
    });

    return {
      success: true,
      message: `Quote ${quote.quoteNumber || quote.id} successfully converted to Contract draft ${contractNumber}`,
      contract: contractRecord,
      leadId: lead._id.toString(),
    };
  }

  async getEnterpriseServiceUsage(organizationId?: string, query?: { status?: string; search?: string }) {
    const orgFilter: FilterQuery<any> = {};
    if (organizationId && Types.ObjectId.isValid(organizationId)) {
      orgFilter._id = new Types.ObjectId(organizationId);
    }
    let orgs: any[] = [];
    if (this.orgModel) {
      orgs = await this.orgModel.find(orgFilter).sort({ createdAt: -1 }).exec();
    }

    const items: any[] = [];
    for (const org of orgs) {
      let convCount = 0;
      let projCount = 0;
      if (this.conversionJobModel) {
        convCount = await this.conversionJobModel.countDocuments({ organizationId: org._id });
      }
      if (this.projectModel) {
        projCount = await this.projectModel.countDocuments({ organizationId: org._id, deletedAt: null });
      }

      const allocatedScreens = org.limits?.maxScreens || org.contractCapacity?.screenCapacity || 50;
      const pct = Math.min(100, Math.round((convCount / (allocatedScreens || 1)) * 100));
      const remainingScreens = Math.max(0, allocatedScreens - convCount);

      let usageStatus: 'ACTIVE' | 'NEAR_CAPACITY' | 'EXCEEDED' | 'EXPIRING_SOON' | 'EXPIRED' = 'ACTIVE';
      if (pct >= 100) {
        usageStatus = 'EXCEEDED';
      } else if (pct >= 80) {
        usageStatus = 'NEAR_CAPACITY';
      }

      const item = {
        organizationId: org._id.toString(),
        name: org.name,
        domain: org.domain || (org.name.toLowerCase().replace(/[^a-z0-9]/g, '') + '.com'),
        serviceMode: org.serviceMode || 'CUSTOMER_SELF_SERVICE',
        engagementType: org.engagementType || 'Enterprise',
        contractNumber: org.activeContractNumber || `CTR-${new Date().getFullYear()}-${org._id.toString().slice(-4).toUpperCase()}`,
        contractExpiresAt: org.contractExpiresAt || org.trialExpiresAt || new Date(Date.now() + 180 * 86400000),
        status: org.status || 'ACTIVE',
        usageStatus,
        screenCapacity: {
          allocated: allocatedScreens,
          used: convCount,
          remaining: remainingScreens,
          pct,
        },
        programCapacity: {
          allocated: org.limits?.maxPrograms || org.contractCapacity?.programCapacity || 25,
          used: Math.round(convCount * 0.4),
        },
        projectCapacity: {
          allocated: org.limits?.maxProjects || org.contractCapacity?.projectCapacity || 10,
          used: projCount,
        },
        userSeats: {
          allocated: org.contractCapacity?.userSeats || 10,
          used: org.members?.length || 1,
        },
        storageGb: {
          allocated: org.limits?.maxStorageGb || org.contractCapacity?.storageGb || 20,
          used: Number((Math.min(org.limits?.maxStorageGb || 20, convCount * 0.05)).toFixed(1)),
        },
      };

      if (query?.status && query.status !== 'ALL') {
        if (query.status === 'NEAR_CAPACITY' && usageStatus !== 'NEAR_CAPACITY') continue;
        if (query.status === 'EXCEEDED' && usageStatus !== 'EXCEEDED') continue;
        if (query.status === 'ACTIVE' && item.status !== 'ACTIVE') continue;
      }

      if (query?.search?.trim()) {
        const s = query.search.trim().toLowerCase();
        if (!item.name.toLowerCase().includes(s) && !item.contractNumber.toLowerCase().includes(s)) {
          continue;
        }
      }

      items.push(item);
    }

    const totalAllocatedScreens = items.reduce((acc, it) => acc + it.screenCapacity.allocated, 0);
    const totalUsedScreens = items.reduce((acc, it) => acc + it.screenCapacity.used, 0);
    const nearCapacityCount = items.filter((it) => it.usageStatus === 'NEAR_CAPACITY').length;
    const exceededCount = items.filter((it) => it.usageStatus === 'EXCEEDED').length;

    return {
      items,
      summary: {
        totalOrganizations: items.length,
        totalAllocatedScreens,
        totalUsedScreens,
        utilizationPct: totalAllocatedScreens > 0 ? Math.round((totalUsedScreens / totalAllocatedScreens) * 100) : 0,
        nearCapacityCount,
        exceededCount,
      },
    };
  }

}
