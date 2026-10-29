import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  EmailVerificationRecord,
  EmailVerificationRepository,
} from '../domain/email-verification.repository';
import { EmailVerification, EmailVerificationDocument } from './email-verification.schema';

@Injectable()
export class MongoEmailVerificationRepository implements EmailVerificationRepository {
  constructor(
    @InjectModel(EmailVerification.name) private readonly model: Model<EmailVerification>,
  ) {}

  async create(input: {
    userId: string;
    tokenHash: string;
    code: string;
    expiresAt: Date;
  }): Promise<EmailVerificationRecord> {
    const doc = await this.model.create({
      userId: new Types.ObjectId(input.userId),
      tokenHash: input.tokenHash,
      code: input.code,
      expiresAt: input.expiresAt,
    });
    return this.map(doc);
  }

  async findLatestActiveByUserId(userId: string): Promise<EmailVerificationRecord | null> {
    const doc = await this.model
      .findOne({
        userId: new Types.ObjectId(userId),
        consumedAt: { $exists: false },
        expiresAt: { $gt: new Date() },
      })
      .read('primary')
      .sort({ createdAt: -1 })
      .exec();
    return doc ? this.map(doc) : null;
  }

  async consumeActive(
    input: Pick<EmailVerificationRecord, 'id' | 'userId' | 'tokenHash' | 'code'>,
  ): Promise<boolean> {
    if (!/^[a-f0-9]{24}$/.test(input.id) || !/^[a-f0-9]{24}$/.test(input.userId)) return false;
    const now = new Date();
    const result = await this.model
      .updateOne(
        {
          _id: new Types.ObjectId(input.id),
          userId: new Types.ObjectId(input.userId),
          tokenHash: input.tokenHash,
          code: input.code,
          consumedAt: { $exists: false },
          expiresAt: { $gt: now },
        },
        { $set: { consumedAt: now } },
        { writeConcern: { w: 'majority', wtimeoutMS: 10000 } },
      )
      .exec();
    if (!result.acknowledged) throw new Error('VERIFICATION_CONSUMPTION_UNCONFIRMED');
    return result.matchedCount === 1 && result.modifiedCount === 1;
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.model
      .updateMany(
        { userId: new Types.ObjectId(userId), consumedAt: { $exists: false } },
        { $set: { consumedAt: new Date() } },
      )
      .exec();
  }

  private map(doc: EmailVerificationDocument): EmailVerificationRecord {
    return {
      id: doc.id,
      userId: doc.userId.toHexString(),
      tokenHash: doc.tokenHash,
      code: doc.code,
      expiresAt: doc.expiresAt,
      consumedAt: doc.consumedAt,
    };
  }
}
