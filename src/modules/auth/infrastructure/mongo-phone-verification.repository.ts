import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import type {
  CreatePhoneVerificationInput,
  PhoneVerificationRecord,
  PhoneVerificationRepository,
} from '../domain/phone-verification.repository';
import { PhoneVerification, type PhoneVerificationDocument } from './phone-verification.schema';

@Injectable()
export class MongoPhoneVerificationRepository implements PhoneVerificationRepository {
  constructor(
    @InjectModel(PhoneVerification.name)
    private readonly model: Model<PhoneVerification>,
  ) {}

  async create(input: CreatePhoneVerificationInput): Promise<PhoneVerificationRecord> {
    const doc = await this.model.create({
      userId: new Types.ObjectId(input.userId),
      phone: input.phone,
      tokenHash: input.tokenHash,
      codeHash: input.codeHash,
      expiresAt: input.expiresAt,
      failedAttempts: 0,
    });
    return this.toRecord(doc);
  }

  async findLatestActive(userId: string, phone: string): Promise<PhoneVerificationRecord | null> {
    const doc = await this.model
      .findOne({
        userId: new Types.ObjectId(userId),
        phone,
        consumedAt: { $exists: false },
        expiresAt: { $gt: new Date() },
      })
      .sort({ createdAt: -1 })
      .exec();
    return doc ? this.toRecord(doc) : null;
  }

  async consumeActive(id: string, userId: string): Promise<boolean> {
    const result = await this.model.updateOne(
      {
        _id: new Types.ObjectId(id),
        userId: new Types.ObjectId(userId),
        consumedAt: { $exists: false },
        expiresAt: { $gt: new Date() },
      },
      { $set: { consumedAt: new Date() } },
      { writeConcern: { w: 'majority', wtimeoutMS: 10_000 } },
    );
    return result.modifiedCount === 1;
  }

  async incrementFailedAttempts(id: string): Promise<number> {
    const doc = await this.model.findOneAndUpdate(
      { _id: new Types.ObjectId(id) },
      { $inc: { failedAttempts: 1 } },
      { new: true },
    );
    return doc?.failedAttempts ?? 0;
  }

  async revokeAllForUserPhone(userId: string, phone: string): Promise<void> {
    await this.model.updateMany(
      {
        userId: new Types.ObjectId(userId),
        phone,
        consumedAt: { $exists: false },
      },
      { $set: { consumedAt: new Date() } },
    );
  }

  async countRecentByUserPhone(userId: string, phone: string, since: Date): Promise<number> {
    return this.model.countDocuments({
      userId: new Types.ObjectId(userId),
      phone,
      createdAt: { $gte: since },
    });
  }

  /* ── mapping ─────────────────────────────────────────────────────── */

  private toRecord(doc: PhoneVerificationDocument): PhoneVerificationRecord {
    return {
      id: doc.id as string,
      userId: String(doc.userId),
      phone: doc.phone,
      tokenHash: doc.tokenHash,
      codeHash: doc.codeHash,
      expiresAt: doc.expiresAt,
      consumedAt: doc.consumedAt,
      createdAt: doc.createdAt,
      failedAttempts: doc.failedAttempts,
    };
  }
}

