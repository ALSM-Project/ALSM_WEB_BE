import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PasswordResetRecord, PasswordResetRepository } from '../domain/password-reset.repository';
import { PasswordReset, PasswordResetDocument } from './password-reset.schema';

@Injectable()
export class MongoPasswordResetRepository implements PasswordResetRepository {
  constructor(@InjectModel(PasswordReset.name) private readonly model: Model<PasswordReset>) {}

  async create(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<PasswordResetRecord> {
    const doc = await this.model.create({
      userId: new Types.ObjectId(input.userId),
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
    });
    return this.map(doc);
  }

  async findActive(tokenHash: string): Promise<PasswordResetRecord | null> {
    const doc = await this.model
      .findOne({ tokenHash, consumedAt: { $exists: false }, expiresAt: { $gt: new Date() } })
      .exec();
    return doc ? this.map(doc) : null;
  }

  async consume(id: string): Promise<void> {
    await this.model
      .updateOne({ _id: id, consumedAt: { $exists: false } }, { $set: { consumedAt: new Date() } })
      .exec();
  }

  private map(doc: PasswordResetDocument): PasswordResetRecord {
    return {
      id: doc.id,
      userId: doc.userId.toString(),
      tokenHash: doc.tokenHash,
      expiresAt: doc.expiresAt,
      consumedAt: doc.consumedAt,
    };
  }
}
