import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
  ContractEmailOutboxRecord,
  ContractNotificationEmailOutboxRepository,
  EnqueueContractEmailInput,
} from '../domain/contract-notification-email-outbox.types';
import { ContractNotificationEmailOutbox } from './contract-notification-email-outbox.schema';

@Injectable()
export class MongoContractNotificationEmailOutboxRepository implements ContractNotificationEmailOutboxRepository {
  constructor(@InjectModel(ContractNotificationEmailOutbox.name) private readonly model: Model<ContractNotificationEmailOutbox>) {}

  async enqueue(input: EnqueueContractEmailInput, session?: ClientSession): Promise<void> {
    await this.model.updateOne(
      { eventKey: input.eventKey },
      {
        $setOnInsert: {
          eventKey: input.eventKey,
          contractId: new Types.ObjectId(input.contractId),
          organizationId: new Types.ObjectId(input.organizationId),
          actorUserId: new Types.ObjectId(input.actorUserId),
          recipientUserId: new Types.ObjectId(input.recipientUserId),
          recipientEmail: input.recipientEmail.trim().toLowerCase(),
          subject: input.subject,
          text: input.text,
          html: input.html,
          status: 'PENDING',
          attempts: 0,
          maxAttempts: 10,
          nextAttemptAt: input.now,
        },
      },
      { upsert: true, ...(session ? { session } : {}) },
    ).exec();
  }

  async claimNext(input: { now: Date; leaseToken: string; leaseExpiresAt: Date }): Promise<ContractEmailOutboxRecord | null> {
    const row = await this.model.findOneAndUpdate(
      {
        $or: [
          { status: { $in: ['PENDING', 'RETRY', 'BLOCKED_CONFIGURATION'] }, nextAttemptAt: { $lte: input.now } },
          { status: 'PROCESSING', leaseExpiresAt: { $lte: input.now } },
        ],
      },
      {
        $set: {
          status: 'PROCESSING',
          leaseToken: input.leaseToken,
          leaseExpiresAt: input.leaseExpiresAt,
          lastAttemptAt: input.now,
        },
        $inc: { attempts: 1 },
      },
      { new: true, sort: { createdAt: 1 } },
    ).exec();
    return row ? this.map(row) : null;
  }

  async settle(input: {
    id: string;
    leaseToken: string;
    status: 'PENDING' | 'RETRY' | 'BLOCKED_CONFIGURATION' | 'SENT' | 'DEAD';
    deliveryResult: 'SENT' | 'NOT_CONFIGURED' | 'UNCONFIRMED' | 'FAILED';
    nextAttemptAt?: Date;
    sentAt?: Date;
  }, session?: ClientSession): Promise<boolean> {
    const set: Record<string, unknown> = { status: input.status, lastDeliveryResult: input.deliveryResult };
    if (input.nextAttemptAt) set.nextAttemptAt = input.nextAttemptAt;
    if (input.sentAt) set.sentAt = input.sentAt;
    const result = await this.model.updateOne(
      { _id: input.id, status: 'PROCESSING', leaseToken: input.leaseToken },
      { $set: set, $unset: { leaseToken: 1, leaseExpiresAt: 1 } },
      session ? { session } : {},
    ).exec();
    return result.modifiedCount === 1;
  }

  private map(row: ContractNotificationEmailOutbox & { _id: Types.ObjectId }): ContractEmailOutboxRecord {
    return {
      id: String(row._id),
      eventKey: row.eventKey,
      contractId: String(row.contractId),
      organizationId: String(row.organizationId),
      actorUserId: String(row.actorUserId),
      recipientUserId: String(row.recipientUserId),
      recipientEmail: row.recipientEmail,
      subject: row.subject,
      text: row.text,
      html: row.html,
      status: row.status,
      attempts: row.attempts,
      maxAttempts: row.maxAttempts,
      nextAttemptAt: row.nextAttemptAt,
      leaseToken: row.leaseToken,
      leaseExpiresAt: row.leaseExpiresAt,
      lastDeliveryResult: row.lastDeliveryResult,
      sentAt: row.sentAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
