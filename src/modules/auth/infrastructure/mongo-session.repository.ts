import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { UserSession, UserSessionDocument } from './user-session.schema';
import { SessionRecord, SessionRepository } from '../domain/session.repository';

@Injectable()
export class MongoSessionRepository implements SessionRepository {
  constructor(@InjectModel(UserSession.name) private readonly model: Model<UserSession>) {}

  async create(input: Omit<SessionRecord, 'id' | 'revokedAt'>): Promise<SessionRecord> {
    const created = await this.model.create({
      ...input,
      userId: new Types.ObjectId(input.userId),
    });
    return this.map(created);
  }

  async findActive(tokenId: string): Promise<SessionRecord | null> {
    const doc = await this.model
      .findOne({ tokenId, revokedAt: { $exists: false }, expiresAt: { $gt: new Date() } })
      .select('+refreshTokenHash')
      .exec();
    return doc ? this.map(doc) : null;
  }

  async findActiveByUserId(userId: string): Promise<SessionRecord[]> {
    const docs = await this.model
      .find({
        userId: new Types.ObjectId(userId),
        revokedAt: { $exists: false },
        expiresAt: { $gt: new Date() },
      })
      .sort({ createdAt: -1 })
      .exec();
    return docs.map((doc) => this.map(doc));
  }

  async updateTokenHash(id: string, hash: string): Promise<void> {
    await this.model.updateOne({ _id: id }, { $set: { refreshTokenHash: hash } }).exec();
  }

  async revoke(id: string): Promise<void> {
    await this.model
      .updateOne({ _id: id, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date() } })
      .exec();
  }

  async revokeUserSession(userId: string, sessionId: string): Promise<boolean> {
    const result = await this.model
      .updateOne(
        {
          _id: sessionId,
          userId: new Types.ObjectId(userId),
          revokedAt: { $exists: false },
        },
        { $set: { revokedAt: new Date() } },
      )
      .exec();
    return result.modifiedCount > 0;
  }

  async revokeAllOther(userId: string, currentTokenId: string): Promise<void> {
    await this.model
      .updateMany(
        {
          userId: new Types.ObjectId(userId),
          tokenId: { $ne: currentTokenId },
          revokedAt: { $exists: false },
        },
        { $set: { revokedAt: new Date() } },
      )
      .exec();
  }

  private map(doc: UserSessionDocument): SessionRecord {
    return {
      id: doc.id,
      tokenId: doc.tokenId,
      userId: doc.userId.toString(),
      refreshTokenHash: doc.refreshTokenHash,
      expiresAt: doc.expiresAt,
      revokedAt: doc.revokedAt,
      userAgent: doc.userAgent,
      ipAddress: doc.ipAddress,
      createdAt: (doc as unknown as { createdAt?: Date }).createdAt,
    };
  }
}

