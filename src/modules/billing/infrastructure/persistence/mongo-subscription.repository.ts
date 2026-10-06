import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
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

  async findActiveByUser(userId: string, session?: ClientSession): Promise<SubscriptionProps | null> {
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
      .session(session ?? null)
      .exec();

    return doc ? SubscriptionMapper.toDomain(doc) : null;
  }

  async findLatestByUser(userId: string, session?: ClientSession): Promise<SubscriptionProps | null> {
    const doc = await this.model
      .findOne({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .session(session ?? null)
      .exec();
    return doc ? SubscriptionMapper.toDomain(doc) : null;
  }

  async create(props: Omit<SubscriptionProps, 'id'>, session?: ClientSession): Promise<SubscriptionProps> {
    const payload = {
      ...props,
      userId: new Types.ObjectId(props.userId),
      organizationId: new Types.ObjectId(props.organizationId),
    };
    const [doc] = session
      ? await this.model.create([payload], { session })
      : await this.model.create([payload]);

    return SubscriptionMapper.toDomain(doc);
  }

  async updatePlan(
    id: string,
    props: Pick<SubscriptionProps, 'planTier' | 'planName' | 'billingCycle' | 'status' | 'amountVnd' | 'currentPeriodStart' | 'currentPeriodEnd'>,
    session?: ClientSession,
  ): Promise<SubscriptionProps | null> {
    const doc = await this.model.findByIdAndUpdate(id, props, { new: true, session }).exec();
    return doc ? SubscriptionMapper.toDomain(doc) : null;
  }

  async updateStatus(
    id: string,
    status: SubscriptionStatus,
    suspension?: { reason: string; actorUserId: string },
    session?: ClientSession,
  ): Promise<SubscriptionProps | null> {
    const set: Record<string, unknown> = { status };
    if (status === SubscriptionStatus.SUSPENDED && suspension) {
      set.suspensionReason = suspension.reason;
      set.suspendedAt = new Date();
      set.suspendedBy = new Types.ObjectId(suspension.actorUserId);
    }
    const update = status === SubscriptionStatus.ACTIVE
      ? { $set: set, $unset: { suspensionReason: '', suspendedAt: '', suspendedBy: '' } }
      : { $set: set };
    const doc = await this.model
      .findByIdAndUpdate(id, update, { new: true, session })
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
