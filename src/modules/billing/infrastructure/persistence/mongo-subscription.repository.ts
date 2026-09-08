import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ISubscriptionRepository,
  SubscriptionProps,
} from '../../domain/billing.repository.interface';
import { SubscriptionStatus } from '../../domain/billing.types';
import { Subscription, SubscriptionDocument } from '../subscription.schema';
import { SubscriptionMapper } from '../mapper/billing.mapper';

@Injectable()
export class MongoSubscriptionRepository implements ISubscriptionRepository {
  constructor(
    @InjectModel(Subscription.name)
    private readonly model: Model<SubscriptionDocument>,
  ) {}

  async findById(id: string): Promise<SubscriptionProps | null> {
    const doc = await this.model.findById(id).exec();
    return doc ? SubscriptionMapper.toDomain(doc) : null;
  }

  async findActiveByUser(userId: string): Promise<SubscriptionProps | null> {
    const doc = await this.model
      .findOne({
        userId: new Types.ObjectId(userId),
        status: {
          $in: [
            SubscriptionStatus.ACTIVE,
            SubscriptionStatus.TRIAL,
            SubscriptionStatus.PENDING_PAYMENT,
          ],
        },
      })
      .sort({ createdAt: -1 })
      .exec();

    return doc ? SubscriptionMapper.toDomain(doc) : null;
  }

  async create(props: Omit<SubscriptionProps, 'id'>): Promise<SubscriptionProps> {
    const doc = await this.model.create({
      ...props,
      userId: new Types.ObjectId(props.userId),
      organizationId: new Types.ObjectId(props.organizationId),
    });

    return SubscriptionMapper.toDomain(doc);
  }

  async updateStatus(id: string, status: SubscriptionStatus): Promise<SubscriptionProps | null> {
    const doc = await this.model
      .findByIdAndUpdate(id, { status }, { new: true })
      .exec();

    return doc ? SubscriptionMapper.toDomain(doc) : null;
  }

  async cancel(id: string, reason: string, feedback?: string): Promise<SubscriptionProps | null> {
    const doc = await this.model
      .findByIdAndUpdate(
        id,
        {
          status: SubscriptionStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelReason: reason,
          cancelFeedback: feedback,
        },
        { new: true },
      )
      .exec();

    return doc ? SubscriptionMapper.toDomain(doc) : null;
  }
}
