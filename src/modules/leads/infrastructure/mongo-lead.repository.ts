import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model } from 'mongoose';
import { requireActiveTransaction } from '../../../shared/database/mongo-transaction-runner';
import { Lead, LeadDocument } from './lead.schema';
import {
  CreateLeadInput,
  LeadListParams,
  LeadRecord,
  LeadRepository,
  LeadStatus,
  LeadQuoteItem,
  LeadPriority,
  LeadSource,
  UpdateLeadStatusOptions,
} from '../domain/lead.types';
import { toValidObjectId } from '../../../shared/utils/object-id.util';

type MongoIdentifier = string | { toString(): string };

type LegacyLeadDocument = {
  id?: MongoIdentifier;
  _id?: MongoIdentifier;
  companyName?: string;
  company?: string;
  title?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  phone?: string;
  jobTitle?: string;
  stage?: string;
  status?: string;
  source?: string;
  priority?: string;
  estimatedValue?: number;
  currency?: string;
  notes?: string;
  assignedToUserId?: MongoIdentifier;
  assignedTo?: MongoIdentifier;
  assignedToEmail?: string;
  tags?: unknown[];
  lastContactedAt?: Date;
  lastContactAt?: Date;
  nextFollowUpAt?: Date;
  createdByUserId?: MongoIdentifier;
  createdByEmail?: string;
  assignments?: Array<{ actorUserId?: MongoIdentifier }>;
  quotes?: LeadQuoteItem[];
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class MongoLeadRepository implements LeadRepository {
  constructor(@InjectModel(Lead.name) private readonly model: Model<Lead>) {}
  private session?: ClientSession;
  private transaction?: object;

  inTransaction(session: ClientSession, connection: Connection): MongoLeadRepository {
    requireActiveTransaction(session);
    if (this.model.db !== connection) throw new Error('Lead transaction connection mismatch');
    const repository = new MongoLeadRepository(this.model);
    repository.session = session;
    repository.transaction = session.transaction;
    return repository;
  }

  private scope(): ClientSession | null {
    if (this.session) {
      requireActiveTransaction(this.session);
      if (this.transaction !== this.session.transaction) throw new Error('Stale lead transaction participant');
    }
    return this.session ?? null;
  }

  async create(input: CreateLeadInput): Promise<LeadRecord> {
    const doc = await this.model.create({
      companyName: input.companyName,
      contactName: input.contactName,
      contactEmail: input.contactEmail.toLowerCase(),
      contactPhone: input.contactPhone,
      jobTitle: input.jobTitle,
      source: input.source,
      priority: input.priority,
      estimatedValue: input.estimatedValue,
      currency: input.currency ?? 'USD',
      notes: input.notes,
      assignedToUserId: input.assignedToUserId
        ? toValidObjectId(input.assignedToUserId)
        : undefined,
      assignedToEmail: input.assignedToEmail?.toLowerCase(),
      tags: input.tags ?? [],
      status: LeadStatus.NEW,
      createdByUserId: toValidObjectId(input.createdByUserId),
      createdByEmail: input.createdByEmail.toLowerCase(),
    });
    return this.map(doc);
  }

  async findById(id: string): Promise<LeadRecord | null> {
    if (!id || !id.match(/^[a-f\d]{24}$/i)) return null;
    const doc = await this.model.findById(id).session(this.scope()).exec();
    return doc ? this.map(doc) : null;
  }

  async list(params?: LeadListParams): Promise<{ items: LeadRecord[]; total: number }> {
    const filter: Record<string, unknown> = {};
    const clauses: Record<string, unknown>[] = [];

    if (params?.status) clauses.push({ $or: [{ stage: params.status }, { status: params.status }] });
    if (params?.source) {
      const sourceLabel = params.source === LeadSource.OTHER
        ? 'Other'
        : params.source.toLowerCase().replace(/_/g, ' ');
      clauses.push({ source: new RegExp(`^${sourceLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
    }
    if (params?.priority && params.priority !== 'MEDIUM') clauses.push({ priority: params.priority });
    if (params?.assignedToUserId) {
      clauses.push({ $or: [
        { assignedToUserId: toValidObjectId(params.assignedToUserId) },
        { assignedToUserId: params.assignedToUserId },
        { assignedTo: params.assignedToUserId },
      ] });
    }
    if (params?.search) {
      clauses.push({ $or: [
        { companyName: { $regex: params.search, $options: 'i' } },
        { company: { $regex: params.search, $options: 'i' } },
        { title: { $regex: params.search, $options: 'i' } },
        { contactName: { $regex: params.search, $options: 'i' } },
        { contactEmail: { $regex: params.search, $options: 'i' } },
      ] });
    }
    if (clauses.length) filter.$and = clauses;

    const page = Math.max(1, params?.page ?? 1);
    const limit = Math.min(100, Math.max(1, params?.limit ?? 20));
    const skip = (page - 1) * limit;

    const sortBy = params?.sortBy || 'createdAt';
    const sortOrder = params?.sortOrder === 'asc' ? 1 : -1;
    const sort: Record<string, 1 | -1> = { [sortBy]: sortOrder };

    const [docs, total] = await Promise.all([
      this.model.find(filter).sort(sort).skip(skip).limit(limit).exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return { items: docs.map((d) => this.map(d)), total };
  }

  async countByStatus(): Promise<Record<string, number>> {
    const results = await this.model.aggregate([
      { $project: { leadStage: { $ifNull: ['$stage', '$status'] } } },
      { $group: { _id: '$leadStage', count: { $sum: 1 } } },
    ]).exec();

    const counts: Record<string, number> = {};
    for (const r of results) {
      counts[r._id as string] = r.count as number;
    }
    return counts;
  }

  async updateStatus(
    id: string,
    status: LeadStatus,
    options?: UpdateLeadStatusOptions,
  ): Promise<LeadRecord | null> {
    if (!id || !id.match(/^[a-f\d]{24}$/i)) return null;

    const updateFields: Record<string, unknown> = {
      stage: status,
      updatedAt: new Date(),
    };

    if (options?.notes !== undefined) {
      updateFields.notes = options.notes;
    }
    if (options?.lastContactedAt !== undefined) {
      updateFields.lastContactAt = options.lastContactedAt;
    }
    if (options?.nextFollowUpAt !== undefined) {
      updateFields.nextFollowUpAt = options.nextFollowUpAt;
    }

    const doc = await this.model
      .findByIdAndUpdate(id, { $set: updateFields }, { new: true, session: this.scope() })
      .exec();

    return doc ? this.map(doc) : null;
  }

  async addQuote(
    id: string,
    quote: LeadQuoteItem,
    newStatus?: LeadStatus,
  ): Promise<LeadRecord | null> {
    if (!id || !id.match(/^[a-f\d]{24}$/i)) return null;

    const update: Record<string, unknown> = {
      $push: { quotes: quote },
      $set: {
        updatedAt: new Date(),
        lastContactedAt: new Date(),
      },
    };

    if (newStatus) {
      (update.$set as Record<string, unknown>)['stage'] = newStatus;
    }

    const doc = await this.model
      .findByIdAndUpdate(id, update, { new: true, session: this.scope() })
      .exec();

    return doc ? this.map(doc) : null;
  }

  async addQuoteOnce(
    id: string,
    quote: LeadQuoteItem,
    expectedStatus: LeadStatus,
    newStatus?: LeadStatus,
  ): Promise<LeadRecord | null> {
    if (!id || !id.match(/^[a-f\d]{24}$/i)) return null;
    const fields: Record<string, unknown> = { updatedAt: new Date(), lastContactAt: new Date() };
    if (newStatus) fields.stage = newStatus;
    const doc = await this.model.findOneAndUpdate(
      {
        _id: id,
        $or: [{ stage: expectedStatus }, { status: expectedStatus }],
        'quotes.requestId': { $ne: quote.requestId },
      },
      { $push: { quotes: quote }, $set: fields },
      { new: true, session: this.scope() },
    ).exec();
    return doc ? this.map(doc) : null;
  }

  private map(doc: LeadDocument): LeadRecord {
    const raw = doc as unknown as LegacyLeadDocument;
    const allowedStatuses = Object.values(LeadStatus);
    const statusValue = String(raw.stage ?? raw.status ?? '').toUpperCase();
    const status = allowedStatuses.includes(statusValue as LeadStatus)
      ? statusValue as LeadStatus
      : LeadStatus.NEW;
    const rawSource = String(raw.source ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
    const source = Object.values(LeadSource).includes(rawSource as LeadSource)
      ? rawSource as LeadSource
      : LeadSource.OTHER;
    const rawPriority = String(raw.priority ?? LeadPriority.MEDIUM).toUpperCase();
    const priority = Object.values(LeadPriority).includes(rawPriority as LeadPriority)
      ? rawPriority as LeadPriority
      : LeadPriority.MEDIUM;
    const firstAssignment = Array.isArray(raw.assignments) ? raw.assignments[0] : undefined;
    const createdByUserId = raw.createdByUserId?.toString?.()
      ?? firstAssignment?.actorUserId?.toString?.()
      ?? raw.assignedTo?.toString?.()
      ?? undefined;
    return {
      id: raw.id?.toString?.() ?? raw._id?.toString?.() ?? '',
      companyName: raw.companyName ?? raw.company ?? raw.title ?? 'Unnamed company',
      contactName: raw.contactName ?? '',
      contactEmail: raw.contactEmail ?? '',
      contactPhone: raw.contactPhone ?? raw.phone,
      jobTitle: raw.jobTitle,
      status,
      source,
      priority,
      estimatedValue: raw.estimatedValue,
      currency: raw.currency ?? 'USD',
      notes: raw.notes,
      assignedToUserId: raw.assignedToUserId?.toString?.() ?? raw.assignedTo?.toString?.(),
      assignedToEmail: raw.assignedToEmail,
      tags: Array.isArray(raw.tags) ? raw.tags.filter((tag): tag is string => typeof tag === 'string') : [],
      lastContactedAt: raw.lastContactedAt ?? raw.lastContactAt,
      nextFollowUpAt: doc.nextFollowUpAt,
      createdByUserId,
      createdByEmail: raw.createdByEmail,
      quotes: (Array.isArray(raw.quotes) ? raw.quotes : []).map((q) => ({
        id: q.id,
        requestId: q.requestId,
        requestFingerprint: q.requestFingerprint,
        quoteNumber: q.quoteNumber,
        planName: q.planName,
        projectScope: q.projectScope,
        amount: q.amount,
        discountPercent: q.discountPercent,
        discountApproved: q.discountApproved,
        discountReason: q.discountReason,
        status: q.status,
        recipientEmail: q.recipientEmail,
        expiresAt: q.expiresAt,
        sentAt: q.sentAt,
        pdfUrl: q.pdfUrl,
        createdAt: q.createdAt,
      })),
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    };
  }
}
