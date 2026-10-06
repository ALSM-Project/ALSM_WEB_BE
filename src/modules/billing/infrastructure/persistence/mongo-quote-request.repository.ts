import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, FilterQuery, Model, Types } from 'mongoose';
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

  async findById(id: string, session?: ClientSession): Promise<QuoteRequestProps | null> {
    const doc = await this.model.findById(id).session(session ?? null).exec();
    return doc ? QuoteRequestMapper.toDomain(doc) : null;
  }

  async findPendingByUser(userId: string): Promise<QuoteRequestProps | null> {
    const doc = await this.model
      .findOne({
        userId: new Types.ObjectId(userId),
        status: { $in: [QuoteRequestStatus.PENDING, QuoteRequestStatus.CONTACTED, QuoteRequestStatus.SUSPENDED] },
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

  async findAll(
    filters?: { status?: QuoteRequestStatus },
    page = 1,
    limit = 10,
  ): Promise<{ items: QuoteRequestProps[]; total: number }> {
    const query: FilterQuery<QuoteRequestDocument> = {};
    if (filters?.status) {
      query.status = filters.status;
    }
    const skip = (page - 1) * limit;
    const [docs, total] = await Promise.all([
      this.model.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).exec(),
      this.model.countDocuments(query).exec(),
    ]);

    return {
      items: docs.map((doc) => QuoteRequestMapper.toDomain(doc)),
      total,
    };
  }

  async create(props: Omit<QuoteRequestProps, 'id'>): Promise<QuoteRequestProps> {
    const doc = await this.model.create({
      ...props,
      userId: new Types.ObjectId(props.userId),
      organizationId: new Types.ObjectId(props.organizationId),
      ...(props.status === QuoteRequestStatus.PENDING
        ? { activeRequestUserId: new Types.ObjectId(props.userId) }
        : {}),
    });

    return QuoteRequestMapper.toDomain(doc);
  }

  async updateStatus(id: string, status: QuoteRequestStatus, reason?: string, session?: ClientSession, expectedStatus?: QuoteRequestStatus): Promise<QuoteRequestProps | null> {
    const current = await this.model.findById(id).session(session ?? null).select('userId status').exec();
    if (!current) return null;
    const set: Record<string, unknown> = { status };
    const unset: Record<string, ''> = {};
    if (reason) set.statusReason = reason;
    if ([QuoteRequestStatus.PENDING, QuoteRequestStatus.CONTACTED, QuoteRequestStatus.SUSPENDED].includes(status)) {
      set.activeRequestUserId = current.userId;
    } else {
      unset.activeRequestUserId = '';
    }
    if (status === QuoteRequestStatus.APPROVED && !reason) unset.statusReason = '';
    const update = Object.keys(unset).length ? { $set: set, $unset: unset } : { $set: set };
    const doc = await this.model.findOneAndUpdate(
      { _id: id, status: expectedStatus ?? current.status },
      update,
      { new: true, session },
    )
      .exec();

    return doc ? QuoteRequestMapper.toDomain(doc) : null;
  }

  async submitAppeal(id: string, message: string): Promise<QuoteRequestProps | null> {
    const doc = await this.model.findOneAndUpdate(
      { _id: id, status: QuoteRequestStatus.SUSPENDED, appealStatus: { $ne: 'PENDING' } },
      { $set: { appealMessage: message, appealStatus: 'PENDING', appealedAt: new Date() }, $unset: { appealResponse: '', appealResolvedAt: '' } },
      { new: true },
    ).exec();
    return doc ? QuoteRequestMapper.toDomain(doc) : null;
  }

  async resolveAppeal(id: string, status: 'APPROVED' | 'DECLINED', response?: string, session?: ClientSession): Promise<QuoteRequestProps | null> {
    const doc = await this.model.findOneAndUpdate(
      {
        _id: id,
        status: status === 'APPROVED'
          ? { $in: [QuoteRequestStatus.SUSPENDED, QuoteRequestStatus.APPROVED] }
          : QuoteRequestStatus.SUSPENDED,
        appealStatus: 'PENDING',
      },
      { $set: { appealStatus: status, appealResolvedAt: new Date(), ...(response ? { appealResponse: response } : {}) } },
      { new: true, session },
    ).exec();
    return doc ? QuoteRequestMapper.toDomain(doc) : null;
  }
}
