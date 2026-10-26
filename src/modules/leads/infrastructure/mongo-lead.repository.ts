import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Lead, LeadDocument } from './lead.schema';
import {
  CreateLeadInput,
  LeadListParams,
  LeadRecord,
  LeadRepository,
  LeadStatus,
  UpdateLeadStatusOptions,
} from '../domain/lead.types';
import { toValidObjectId } from '../../../shared/utils/object-id.util';

@Injectable()
export class MongoLeadRepository implements LeadRepository {
  constructor(@InjectModel(Lead.name) private readonly model: Model<Lead>) {}

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
    const doc = await this.model.findById(id).exec();
    return doc ? this.map(doc) : null;
  }

  async list(params?: LeadListParams): Promise<{ items: LeadRecord[]; total: number }> {
    const filter: Record<string, unknown> = {};

    if (params?.status) filter['status'] = params.status;
    if (params?.source) filter['source'] = params.source;
    if (params?.priority) filter['priority'] = params.priority;
    if (params?.assignedToUserId) {
      filter['assignedToUserId'] = toValidObjectId(params.assignedToUserId);
    }
    if (params?.search) {
      filter['$or'] = [
        { companyName: { $regex: params.search, $options: 'i' } },
        { contactName: { $regex: params.search, $options: 'i' } },
        { contactEmail: { $regex: params.search, $options: 'i' } },
      ];
    }

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
      { $group: { _id: '$status', count: { $sum: 1 } } },
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
      updateFields.lastContactedAt = options.lastContactedAt;
    }
    if (options?.nextFollowUpAt !== undefined) {
      updateFields.nextFollowUpAt = options.nextFollowUpAt;
    }

    const doc = await this.model
      .findByIdAndUpdate(id, { $set: updateFields }, { new: true })
      .exec();

    return doc ? this.map(doc) : null;
  }

  private map(doc: LeadDocument): LeadRecord {
    return {
      id: doc.id as string,
      companyName: doc.companyName,
      contactName: doc.contactName,
      contactEmail: doc.contactEmail,
      contactPhone: doc.contactPhone,
      jobTitle: doc.jobTitle,
      status: doc.status,
      source: doc.source,
      priority: doc.priority,
      estimatedValue: doc.estimatedValue,
      currency: doc.currency,
      notes: doc.notes,
      assignedToUserId: doc.assignedToUserId?.toString(),
      assignedToEmail: doc.assignedToEmail,
      tags: doc.tags,
      lastContactedAt: doc.lastContactedAt,
      nextFollowUpAt: doc.nextFollowUpAt,
      createdByUserId: doc.createdByUserId.toString(),
      createdByEmail: doc.createdByEmail,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }
}
