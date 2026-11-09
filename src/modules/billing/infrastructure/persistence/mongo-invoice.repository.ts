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

  async findByContractNumber(contractNumber: string): Promise<InvoiceProps | null> {
    if (!contractNumber) return null;
    const doc = await this.model.findOne({ contractNumber: contractNumber.trim() }).sort({ createdAt: -1 }).exec();
    return doc ? InvoiceMapper.toDomain(doc) : null;
  }

  async findByContractId(contractId: string): Promise<InvoiceProps | null> {
    if (!contractId || !Types.ObjectId.isValid(contractId)) return null;
    const doc = await this.model.findOne({ contractId: new Types.ObjectId(contractId) }).sort({ createdAt: -1 }).exec();
    return doc ? InvoiceMapper.toDomain(doc) : null;
  }

  async findInvoices(options: InvoiceQueryOptions): Promise<{ items: InvoiceProps[]; total: number }> {
    const filter: FilterQuery<InvoiceDocument> = {};

    const orClauses: any[] = [];

    // Support multiple organization IDs or single organizationId (matching both ObjectId and String)
    const orgIds: any[] = [];
    if (options.organizationIds && Array.isArray(options.organizationIds)) {
      options.organizationIds.forEach((id: string) => {
        if (!id) return;
        orgIds.push(id.toString());
        if (Types.ObjectId.isValid(id)) orgIds.push(new Types.ObjectId(id));
      });
    }
    if (options.organizationId) {
      orgIds.push(options.organizationId.toString());
      if (Types.ObjectId.isValid(options.organizationId)) {
        orgIds.push(new Types.ObjectId(options.organizationId));
      }
    }

    if (orgIds.length > 0) {
      orClauses.push({ organizationId: { $in: orgIds } });
    }

    if (options.userId) {
      const uId = options.userId.toString();
      const validUObjId = Types.ObjectId.isValid(uId) ? new Types.ObjectId(uId) : null;
      orClauses.push({ userId: validUObjId ? { $in: [uId, validUObjId] } : uId });
    }

    if (options.userEmail) {
      const email = options.userEmail.toLowerCase().trim();
      orClauses.push({ customerEmail: email });
      orClauses.push({ customerEmail: new RegExp(`^${email}$`, 'i') });
    }

    if (orClauses.length > 0) {
      filter.$or = orClauses;
    }

    if (options.contractNumber) {
      filter.contractNumber = options.contractNumber;
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
      const searchConditions: any[] = [{ invoiceNumber: searchRegex }, { planName: searchRegex }, { contractNumber: searchRegex }];
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
      subscriptionId: props.subscriptionId && Types.ObjectId.isValid(props.subscriptionId) ? new Types.ObjectId(props.subscriptionId) : undefined,
      contractId: props.contractId && Types.ObjectId.isValid(props.contractId) ? new Types.ObjectId(props.contractId) : undefined,
    });

    return InvoiceMapper.toDomain(doc);
  }

  async markPaid(id: string, paymentMethod: string, cassoTxId?: string): Promise<InvoiceProps | null> {
    if (!id || !Types.ObjectId.isValid(id)) return null;
    const updatePayload: any = {
      status: InvoiceStatus.PAID,
      paidAt: new Date(),
      paymentMethod,
    };
    if (cassoTxId) {
      updatePayload.cassoTransactionId = cassoTxId;
    }
    const doc = await this.model
      .findByIdAndUpdate(
        id,
        updatePayload,
        { new: true },
      )
      .exec();

    return doc ? InvoiceMapper.toDomain(doc) : null;
  }
}
