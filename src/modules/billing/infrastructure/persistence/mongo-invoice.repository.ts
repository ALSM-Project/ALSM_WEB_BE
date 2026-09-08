import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  IInvoiceRepository,
  InvoiceProps,
} from '../../domain/billing.repository.interface';
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
    const doc = await this.model.findById(id).exec();
    return doc ? InvoiceMapper.toDomain(doc) : null;
  }

  async findRecentByUser(userId: string, limit = 20): Promise<InvoiceProps[]> {
    const docs = await this.model
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();

    return docs.map(InvoiceMapper.toDomain);
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
