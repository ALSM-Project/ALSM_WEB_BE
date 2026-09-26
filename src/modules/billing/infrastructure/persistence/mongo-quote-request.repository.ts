import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  IQuoteRequestRepository,
  QuoteRequestProps,
} from '../../domain/billing.repository.interface';
import { QuoteRequestStatus } from '../../domain/billing.types';
import { QuoteRequest, QuoteRequestDocument } from '../quote-request.schema';
import { QuoteRequestMapper } from '../mapper/billing.mapper';

@Injectable()
export class MongoQuoteRequestRepository implements IQuoteRequestRepository {
  constructor(
    @InjectModel(QuoteRequest.name)
    private readonly model: Model<QuoteRequestDocument>,
  ) {}

  async findById(id: string): Promise<QuoteRequestProps | null> {
    const doc = await this.model.findById(id).exec();
    return doc ? QuoteRequestMapper.toDomain(doc) : null;
  }

  async findPendingByUser(userId: string): Promise<QuoteRequestProps | null> {
    const doc = await this.model
      .findOne({
        userId: new Types.ObjectId(userId),
        status: QuoteRequestStatus.PENDING,
      })
      .sort({ createdAt: -1 })
      .exec();

    return doc ? QuoteRequestMapper.toDomain(doc) : null;
  }

  async findLatestByUser(userId: string): Promise<QuoteRequestProps | null> {
    const doc = await this.model
      .findOne({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .exec();

    return doc ? QuoteRequestMapper.toDomain(doc) : null;
  }

  async create(props: Omit<QuoteRequestProps, 'id'>): Promise<QuoteRequestProps> {
    const doc = await this.model.create({
      ...props,
      userId: new Types.ObjectId(props.userId),
      organizationId: new Types.ObjectId(props.organizationId),
    });

    return QuoteRequestMapper.toDomain(doc);
  }

  async updateStatus(id: string, status: QuoteRequestStatus): Promise<QuoteRequestProps | null> {
    const doc = await this.model
      .findByIdAndUpdate(id, { status }, { new: true })
      .exec();

    return doc ? QuoteRequestMapper.toDomain(doc) : null;
  }
}
