import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { IInvoiceRepository, InvoiceProps, InvoiceQueryOptions } from '../../domain/billing.repository.interface';
import { InvoiceStatus } from '../../domain/billing.types';
import { Invoice, InvoiceDocument } from '../invoice.schema';
import { InvoiceMapper } from '../mapper/billing.mapper';

@Injectable()
export class MongoInvoiceRepository implements IInvoiceRepository {
  constructor(
    @InjectModel(Invoice.name)
    private readonly model: Model<InvoiceDocument>,
  ) {}

  async findById(id: string): Promise<InvoiceProps | null> {
    if (!id || !Types.ObjectId.isValid(id)) return null;
    const doc = await this.model.findById(id).exec();
    return doc ? InvoiceMapper.toDomain(doc) : null;
  }

  async findRecentByUser(userId: string, limit = 20): Promise<InvoiceProps[]> {
    if (!userId || !Types.ObjectId.isValid(userId)) return [];
    const docs = await this.model
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();

    return docs.map(InvoiceMapper.toDomain);
  }

  async findByOrganizationId(organizationId: string, limit = 20): Promise<InvoiceProps[]> {
    if (!organizationId || !Types.ObjectId.isValid(organizationId)) return [];
    const docs = await this.model
      .find({ organizationId: new Types.ObjectId(organizationId) })
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();

    return docs.map(InvoiceMapper.toDomain);
  }

  async findByInvoiceNumber(invoiceNumber: string): Promise<InvoiceProps | null> {
    if (!invoiceNumber) return null;
    const doc = await this.model.findOne({ invoiceNumber: invoiceNumber.trim() }).exec();
    return doc ? InvoiceMapper.toDomain(doc) : null;
  }

  async findInvoices(options: InvoiceQueryOptions): Promise<{ items: InvoiceProps[]; total: number }> {
    const filter: FilterQuery<InvoiceDocument> = {};

    if (options.organizationId && Types.ObjectId.isValid(options.organizationId)) {
      if (options.userId && Types.ObjectId.isValid(options.userId)) {
        filter.$or = [
          { organizationId: new Types.ObjectId(options.organizationId) },
          { userId: new Types.ObjectId(options.userId) },
        ];
      } else {
        filter.organizationId = new Types.ObjectId(options.organizationId);
      }
    } else if (options.userId && Types.ObjectId.isValid(options.userId)) {
      filter.userId = new Types.ObjectId(options.userId);
    }

    if (options.status) {
      filter.status = options.status;
    }

    if (options.planTier) {
      filter.planTier = options.planTier;
    }

    if (options.startDate || options.endDate) {
      filter.createdAt = {};
      if (options.startDate) {
        filter.createdAt.$gte = new Date(options.startDate);
      }
      if (options.endDate) {
        filter.createdAt.$lte = new Date(options.endDate);
      }
    }

    if (options.search?.trim()) {
      const searchRegex = new RegExp(options.search.trim(), 'i');
      const searchConditions = [{ invoiceNumber: searchRegex }, { planName: searchRegex }];
      if (filter.$or) {
        filter.$and = [{ $or: filter.$or }, { $or: searchConditions }];
        delete filter.$or;
      } else {
        filter.$or = searchConditions;
      }
    }

    const skip = Math.max(0, options.skip || 0);
    const limit = Math.max(1, Math.min(100, options.limit || 20));

    const [docs, total] = await Promise.all([
      this.model.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return {
      items: docs.map(InvoiceMapper.toDomain),
      total,
    };
  }

  async countDocuments(): Promise<number> {
    return this.model.countDocuments().exec();
  }

  async create(props: Omit<InvoiceProps, 'id'>): Promise<InvoiceProps> {
    const doc = await this.model.create({
      ...props,
      userId: new Types.ObjectId(props.userId),
      organizationId: new Types.ObjectId(props.organizationId),
      subscriptionId: props.subscriptionId ? new Types.ObjectId(props.subscriptionId) : undefined,
    });

    return InvoiceMapper.toDomain(doc);
  }

  async markPaid(id: string, paymentMethod: string): Promise<InvoiceProps | null> {
    if (!id || !Types.ObjectId.isValid(id)) return null;
    const doc = await this.model
      .findByIdAndUpdate(
        id,
        {
          status: InvoiceStatus.PAID,
          paidAt: new Date(),
          paymentMethod,
        },
        { new: true },
      )
      .exec();

    return doc ? InvoiceMapper.toDomain(doc) : null;
  }
}
