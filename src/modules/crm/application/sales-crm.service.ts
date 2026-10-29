import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { randomBytes, randomUUID } from 'node:crypto';
import { Lead, LeadDocument } from '../infrastructure/lead.schema';
import { Organization } from '../../organizations/infrastructure/organization.schema';
import { OrganizationRole, OrganizationType } from '../../organizations/domain/organization.types';
import { User } from '../../users/infrastructure/user.schema';
import { AUDIT_REPOSITORY, AuditRepository } from '../../audit/domain/audit.repository';
import { LeadStatus } from '../domain/lead.types';
import {
  SALES_PIPELINE_STAGES,
  SalesPipelineLead,
  SalesPipelineQuery,
  SalesPipelineStage,
  SalesPipelineView,
} from '../domain/sales-pipeline.types';

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
  title: string;
  scheduledAt: string;
  description?: string;
}

export interface SendQuoteDto {
  planName: string;
  projectScope?: string;
  amount: number;
  discountPercent?: number;
  discountReason?: string;
}

export interface CreateContractDto {
  quoteId?: string;
  documentTitle: string;
}

@Injectable()
export class SalesCrmService {
  constructor(
    @InjectModel(Lead.name) private readonly leadModel: Model<Lead>,
    @InjectModel(Organization.name) private readonly orgModel: Model<Organization>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
  ) {}

  async listLeads(
    organizationId?: string,
    query?: { stage?: string; search?: string },
  ) {
    const filter: FilterQuery<LeadDocument> = {};
    if (organizationId && Types.ObjectId.isValid(organizationId)) {
      filter.organizationId = new Types.ObjectId(organizationId);
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
      clauses.push({ organizationId: new Types.ObjectId(query.organizationId) });
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

  async updateStage(
    userId: string,
    leadId: string,
    newStage: 'NEW' | 'CONTACTED' | 'QUALIFIED' | 'PROPOSAL' | 'WON' | 'LOST',
  ) {
    const doc = await this.findLeadById(leadId);
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

    const demo = {
      id: randomUUID(),
      title: dto.title,
      scheduledAt: new Date(dto.scheduledAt),
      description: dto.description,
      meetLink,
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
      metadata: { title: dto.title, meetLink },
    });

    return this.mapLead(doc);
  }

  async sendQuote(userId: string, leadId: string, dto: SendQuoteDto) {
    const doc = await this.findLeadById(leadId);
    const discount = dto.discountPercent || 0;
    const requiresApproval = discount > 0;
    const quoteStatus = requiresApproval ? 'PENDING_APPROVAL' : 'SENT';

    const quote = {
      id: randomUUID(),
      planName: dto.planName,
      projectScope: dto.projectScope,
      amount: dto.amount,
      discountPercent: discount,
      discountApproved: !requiresApproval,
      discountReason: dto.discountReason,
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

  async createContract(userId: string, leadId: string, dto: CreateContractDto) {
    const doc = await this.findLeadById(leadId);
    const envelopeId = `docusign_env_${Date.now()}_${randomBytes(4).toString('hex')}`;

    const contract = {
      id: randomUUID(),
      quoteId: dto.quoteId,
      documentTitle: dto.documentTitle || `${doc.company || 'Customer'} Service Modernization Agreement`,
      status: 'SENT_FOR_SIGNATURE' as const,
      envelopeId,
      signedAt: undefined,
      createdAt: new Date(),
    };

    doc.contracts.push(contract);
    await doc.save();

    await this.audit.append({
      actorUserId: userId,
      organizationId: doc.organizationId?.toString(),
      action: 'LEAD_CONTRACT_CREATED',
      resourceType: 'LEAD',
      resourceId: doc.id,
      metadata: { documentTitle: contract.documentTitle, envelopeId },
    });

    return this.mapLead(doc);
  }

  async signContract(userId: string, leadId: string, contractId: string) {
    const doc = await this.findLeadById(leadId);
    const contract = (doc.contracts || []).find((c) => c.id === contractId);
    if (!contract) {
      throw new NotFoundException('Contract was not found on this lead');
    }

    contract.status = 'SIGNED';
    contract.signedAt = new Date();
    doc.stage = 'WON';
    await doc.save();

    await this.audit.append({
      actorUserId: userId,
      organizationId: doc.organizationId?.toString(),
      action: 'LEAD_CONTRACT_SIGNED',
      resourceType: 'LEAD',
      resourceId: doc.id,
      metadata: { contractId, envelopeId: contract.envelopeId || '' },
    });

    // Auto-provision Enterprise Org and Customer Admin user upon won
    await this.autoProvisionCustomer(userId, doc);

    return this.mapLead(doc);
  }

  async autoProvisionCustomer(userId: string, leadDoc: LeadDocument) {
    try {
      const orgName = leadDoc.company || `${leadDoc.contactName} Enterprise`;
      let org = await this.orgModel.findOne({ name: orgName }).exec();
      if (!org) {
        org = await this.orgModel.create({
          name: orgName,
          type: OrganizationType.ENTERPRISE,
          members: [],
        });
      }

      const email = leadDoc.contactEmail || `customer_${Date.now()}@example.com`;
      let user = await this.userModel.findOne({ email }).exec();
      if (!user) {
        user = await this.userModel.create({
          email,
          fullName: leadDoc.contactName || orgName,
          isActive: true,
          isPlatformAdmin: false,
        });
      }

      if (!org.members.some((m) => m.userId.toString() === user!._id.toString())) {
        org.members.push({ userId: user!._id, role: OrganizationRole.ADMIN });
        await org.save();
      }

      await this.audit.append({
        actorUserId: userId,
        organizationId: org._id.toString(),
        action: 'LEAD_CUSTOMER_AUTO_PROVISIONED',
        resourceType: 'ORGANIZATION',
        resourceId: org._id.toString(),
        metadata: { leadId: leadDoc.id, customerEmail: email },
      });
    } catch {
      // Non-blocking provisioning fallback
    }
  }

  // Section 3.12: Sales Reports & Approvals
  async getSalesReports(teamId?: string) {
    const leads = await this.leadModel.find().exec();
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

    // Total quote revenues
    const allQuotes = leads.flatMap((l) => l.quotes || []);
    const acceptedQuotes = allQuotes.filter((q) => q.status === 'ACCEPTED' || q.status === 'SENT');
    const totalRevenue = acceptedQuotes.reduce((sum, q) => sum + (q.amount || 0), 0);
    const avgDealSize = acceptedQuotes.length > 0 ? Math.round(totalRevenue / acceptedQuotes.length) : 0;

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
      teamId: teamId || 'all',
      lastUpdated: new Date().toISOString(),
    };
  }

  async exportSalesReportsCsv() {
    const leads = await this.leadModel.find().sort({ createdAt: -1 }).exec();
    const headers = 'ID,Company,Contact,Email,Phone,Source,Stage,Score,LastContactAt,Created\n';
    const rows = leads.map((l) => {
      const createdAtStr = l.createdAt ? new Date(l.createdAt).toISOString() : '';
      return `"${l.id}","${l.company || ''}","${l.contactName || ''}","${l.contactEmail || ''}","${l.phone || ''}","${l.source || ''}","${l.stage}","${l.score}","${l.lastContactAt ? l.lastContactAt.toISOString() : ''}","${createdAtStr}"`;
    });
    return headers + rows.join('\n');
  }

  async getPendingDiscounts() {
    const leads = await this.leadModel.find({ 'quotes.status': 'PENDING_APPROVAL' }).exec();
    const pendingList: Array<{
      leadId: string;
      company?: string;
      contactName?: string;
      quote: Record<string, unknown>;
    }> = [];

    for (const lead of leads) {
      for (const quote of lead.quotes || []) {
        if (quote.status === 'PENDING_APPROVAL') {
          pendingList.push({
            leadId: lead.id,
            company: lead.company,
            contactName: lead.contactName,
            quote,
          });
        }
      }
    }

    return pendingList;
  }

  async reviewDiscount(
    userId: string,
    leadId: string,
    quoteId: string,
    approved: boolean,
    reason?: string,
  ) {
    const doc = await this.findLeadById(leadId);
    const quote = (doc.quotes || []).find((q) => q.id === quoteId);
    if (!quote) {
      throw new NotFoundException('Quote was not found');
    }

    quote.discountApproved = approved;
    quote.status = approved ? 'SENT' : 'REJECTED';
    if (approved) {
      quote.sentAt = new Date();
    }
    await doc.save();

    await this.audit.append({
      actorUserId: userId,
      organizationId: doc.organizationId?.toString(),
      action: approved ? 'DISCOUNT_APPROVED' : 'DISCOUNT_REJECTED',
      resourceType: 'QUOTE',
      resourceId: quoteId,
      metadata: { leadId, approved: String(approved), reason: reason || '' },
    });

    return { success: true, quote };
  }

  private async findLeadById(id: string) {
    let doc: LeadDocument | null = null;
    if (Types.ObjectId.isValid(id)) {
      doc = await this.leadModel.findById(id).exec();
    }
    if (!doc) {
      doc = await this.leadModel.findOne({ id }).exec();
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

  private mapLead(doc: LeadDocument) {
    return {
      id: doc.id || doc._id.toString(),
      organizationId: doc.organizationId?.toString(),
      title: doc.title,
      contactName: doc.contactName,
      company: doc.company,
      contactEmail: doc.contactEmail,
      phone: doc.phone,
      source: doc.source,
      stage: doc.stage || 'NEW',
      score: doc.score ?? 50,
      lastContactAt: doc.lastContactAt,
      notes: doc.notes,
      assignedTo: doc.assignedTo,
      interactions: doc.interactions || [],
      demos: doc.demos || [],
      quotes: doc.quotes || [],
      contracts: doc.contracts || [],
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }
}
