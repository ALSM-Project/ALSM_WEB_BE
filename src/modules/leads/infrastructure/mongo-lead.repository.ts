import { ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { requireActiveTransaction } from '../../../shared/database/mongo-transaction-runner';
import { Lead, LeadDocument, UC58_LEAD_MODEL } from './lead.schema';
import {
  CreateLeadInput,
  CreateLeadResult,
  LeadListParams,
  LeadRecord,
  LeadRepository,
  LeadStatus,
  LeadQuoteItem,
  LeadPriority,
  LeadSource,
  LeadEmailNotificationStatus,
  LeadPhoneCall,
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
  emailNotificationStatus?: LeadEmailNotificationStatus;
  emailNotifiedAt?: Date;
  assignments?: Array<{ actorUserId?: MongoIdentifier }>;
  quotes?: LeadQuoteItem[];
  phoneCalls?: LeadPhoneCall[];
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class MongoLeadRepository implements LeadRepository {
  constructor(@InjectModel(UC58_LEAD_MODEL) private readonly model: Model<Lead>) {}
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

  async create(input: CreateLeadInput): Promise<CreateLeadResult> {
    const session = this.scope();
    if (!session) throw new Error('Lead creation requires the audited unit of work');

    const existingByRequest = await this.model
      .findById(input.id)
      .select('+creationFingerprint')
      .session(session)
      .exec();
    if (existingByRequest) {
      if (existingByRequest.creationFingerprint !== input.creationFingerprint) {
        throw new ConflictException({
          code: 'IDEMPOTENCY_KEY_REUSED',
          message: 'This request ID was already used for different lead details',
        });
      }
      return { lead: this.map(existingByRequest), replayed: true };
    }

    const duplicateEmail = await this.model
      .findOne({
        $or: [
          { dedupeKey: input.dedupeKey },
          { contactEmail: input.contactEmail.toLowerCase() },
        ],
      })
      .session(session)
      .exec();
    if (duplicateEmail) {
      throw new ConflictException({
        code: 'LEAD_EMAIL_EXISTS',
        message: 'A lead with this contact email already exists',
      });
    }

    const [doc] = await this.model.create(
      [
        {
          _id: new Types.ObjectId(input.id),
          creationFingerprint: input.creationFingerprint,
          dedupeKey: input.dedupeKey,
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
        },
      ],
      { session },
    );
    return { lead: this.map(doc), replayed: false };
  }

  async findById(id: string): Promise<LeadRecord | null> {
    if (!id || !id.match(/^[a-f\d]{24}$/i)) return null;
    const doc = await this.model.findById(id).session(this.scope()).exec();
    return doc ? this.map(doc) : null;
  }

  async list(params?: LeadListParams): Promise<{ items: LeadRecord[]; total: number }> {
    const filter: Record<string, unknown> = {};
    const clauses: Record<string, unknown>[] = [];

    if (params?.status) {
      clauses.push({
        $or: [
          { status: params.status },
          { status: { $exists: false }, stage: params.status },
        ],
      });
    }
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
      { $project: { leadStage: { $ifNull: ['$status', '$stage'] } } },
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
      status,
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
      (update.$set as Record<string, unknown>).status = newStatus;
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
    if (newStatus) fields.status = newStatus;
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

  async addPhoneCallOnce(
    id: string,
    call: LeadPhoneCall,
    expectedStatus: LeadStatus,
    newStatus: LeadStatus,
  ): Promise<LeadRecord | null> {
    if (!id || !/^[a-f\d]{24}$/i.test(id)) return null;
    const doc = await this.model.findOneAndUpdate(
      {
        _id: new Types.ObjectId(id),
        $or: [
          { status: expectedStatus },
          { status: { $exists: false }, stage: expectedStatus },
        ],
        'phoneCalls.requestId': { $ne: call.requestId },
      },
      {
        $push: { phoneCalls: call },
        $set: {
          status: newStatus,
          lastContactedAt: call.createdAt,
          ...(call.followUpAt ? { nextFollowUpAt: call.followUpAt } : {}),
          updatedAt: call.createdAt,
        },
      },
      { new: true, session: this.scope() },
    ).exec();
    return doc ? this.map(doc) : null;
  }

  async claimEmailNotification(id: string, requestId: string): Promise<LeadRecord | null> {
    if (!id || !/^[a-f\d]{24}$/i.test(id)) return null;
    const doc = await this.model.findOneAndUpdate(
      {
        _id: new Types.ObjectId(id),
        emailNotificationRequestId: { $ne: requestId },
        $or: [
          { emailNotificationStatus: { $in: ['PENDING', 'FAILED'] } },
          { emailNotificationStatus: { $exists: false } },
        ],
      },
      {
        $set: {
          emailNotificationRequestId: requestId,
          emailNotificationStatus: 'SENDING',
        },
        $unset: { emailNotifiedAt: 1 },
      },
      { new: true, session: this.scope() },
    ).exec();
    return doc ? this.map(doc) : null;
  }

  async completeEmailNotification(
    id: string,
    requestId: string,
    delivered: boolean,
  ): Promise<LeadRecord | null> {
    if (!id || !/^[a-f\d]{24}$/i.test(id)) return null;
    const doc = await this.model.findOneAndUpdate(
      {
        _id: new Types.ObjectId(id),
        emailNotificationRequestId: requestId,
        emailNotificationStatus: 'SENDING',
      },
      delivered
        ? {
            $set: { emailNotificationStatus: 'SENT', emailNotifiedAt: new Date() },
          }
        : {
            $set: { emailNotificationStatus: 'FAILED' },
            $unset: { emailNotifiedAt: 1 },
          },
      { new: true, session: this.scope() },
    ).exec();
    return doc ? this.map(doc) : null;
  }

  private map(doc: LeadDocument): LeadRecord {
    const raw = doc as unknown as LegacyLeadDocument;
    const allowedStatuses = Object.values(LeadStatus);
    const statusValue = String(raw.status ?? raw.stage ?? '').toUpperCase();
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
      emailNotificationStatus: raw.emailNotificationStatus,
      emailNotifiedAt: raw.emailNotifiedAt,
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
      phoneCalls: (Array.isArray(raw.phoneCalls) ? raw.phoneCalls : []).map((call) => ({
        id: call.id,
        requestId: call.requestId,
        requestFingerprint: call.requestFingerprint,
        durationMinutes: call.durationMinutes,
        outcome: call.outcome,
        summary: call.summary,
        notes: call.notes,
        followUpAt: call.followUpAt,
        performedByUserId: call.performedByUserId,
        performedByEmail: call.performedByEmail,
        createdAt: call.createdAt,
      })),
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    };
  }
}
