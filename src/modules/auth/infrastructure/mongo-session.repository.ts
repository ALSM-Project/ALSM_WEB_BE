import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { UserSession, UserSessionDocument } from './user-session.schema';
import {
  BrowserRevocation,
  RefreshRotation,
  SessionPersistenceUnavailableError,
  SessionRecord,
  SessionRepository,
} from '../domain/session.repository';

const majority = { w: 'majority' as const, wtimeoutMS: 10000 };
const hashPattern = /^\$2[aby]\$(0[4-9]|[12]\d|3[01])\$[./A-Za-z0-9]{53}$/;
const canonicalId = (id: string) => typeof id === 'string' && /^[a-f0-9]{24}$/.test(id);

@Injectable()
export class MongoSessionRepository implements SessionRepository {
  constructor(@InjectModel(UserSession.name) private readonly model: Model<UserSession>) {}

  async create(input: Omit<SessionRecord, 'id' | 'revokedAt'>): Promise<SessionRecord> {
    const [created] = await this.model.create(
      [
        {
          ...input,
          userId: new Types.ObjectId(input.userId),
        },
      ],
      { writeConcern: majority },
    );
    return this.map(created);
  }

  async findActive(tokenId: string): Promise<SessionRecord | null> {
    const doc = await this.model
      .findOne({ tokenId, revokedAt: { $exists: false }, expiresAt: { $gt: new Date() } })
      .select('+refreshTokenHash')
      .read('primary')
      .exec();
    return doc ? this.map(doc) : null;
  }

  async findActiveByUserId(userId: string): Promise<SessionRecord[]> {
    if (!Types.ObjectId.isValid(userId)) return [];

    const docs = await this.model
      .find({
        userId: new Types.ObjectId(userId),
        revokedAt: { $exists: false },
        expiresAt: { $gt: new Date() },
      })
      .read('primary')
      .sort({ createdAt: -1 })
      .exec();
    return docs.map((doc) => this.map(doc));
  }

  async updateTokenHash(id: string, hash: string): Promise<void> {
    try {
      const result = await this.model
        .updateOne(
          { _id: id, revokedAt: { $exists: false }, refreshTokenHash: 'pending' },
          { $set: { refreshTokenHash: hash } },
          { writeConcern: majority },
        )
        .exec();
      if (!result.acknowledged || result.matchedCount !== 1 || result.modifiedCount !== 1)
        throw new SessionPersistenceUnavailableError();
    } catch {
      throw new SessionPersistenceUnavailableError();
    }
  }

  async revoke(id: string): Promise<void> {
    try {
      const result = await this.model
        .updateOne(
          { _id: id, revokedAt: { $exists: false } },
          { $set: { revokedAt: new Date() } },
          { writeConcern: majority },
        )
        .exec();
      if (!result.acknowledged) throw new SessionPersistenceUnavailableError();
    } catch {
      throw new SessionPersistenceUnavailableError();
    }
  }

  async revokeUserSession(userId: string, sessionId: string): Promise<boolean> {
    if (!canonicalId(userId) || !canonicalId(sessionId)) {
      return false;
    }

    try {
      const result = await this.model
        .updateOne(
          {
            _id: sessionId,
            userId: new Types.ObjectId(userId),
            revokedAt: { $exists: false },
            expiresAt: { $gt: new Date() },
          },
          { $set: { revokedAt: new Date() } },
          { writeConcern: majority },
        )
        .exec();
      if (!result.acknowledged) throw new SessionPersistenceUnavailableError();
      return result.matchedCount === 1 && result.modifiedCount === 1;
    } catch {
      throw new SessionPersistenceUnavailableError();
    }
  }

  async rotateRefresh(input: RefreshRotation): Promise<boolean> {
    if (
      !canonicalId(input.sessionId) ||
      !canonicalId(input.userId) ||
      !input.familyId ||
      !input.expectedTokenId ||
      !input.successorTokenId ||
      input.expectedTokenId === input.successorTokenId ||
      !hashPattern.test(input.expectedTokenHash) ||
      !hashPattern.test(input.successorTokenHash) ||
      !Number.isFinite(input.expiresAt.getTime()) ||
      input.expiresAt.getTime() <= Date.now()
    )
      return false;
    try {
      // Complete single-document transition: no successor row, transaction callback,
      // process-local lock, independent create, or blind application-level retry.
      const result = await this.model
        .updateOne(
          {
            _id: new Types.ObjectId(input.sessionId),
            userId: new Types.ObjectId(input.userId),
            tokenId: input.expectedTokenId,
            refreshTokenHash: input.expectedTokenHash,
            revokedAt: { $exists: false },
            expiresAt: { $gt: new Date() },
          },
          {
            $set: {
              tokenId: input.successorTokenId,
              refreshTokenHash: input.successorTokenHash,
              accessVersion: input.successorTokenId,
              familyId: input.familyId,
              expiresAt: input.expiresAt,
              lastActiveAt: input.lastActiveAt,
              deviceType: input.deviceType,
              browser: input.browser,
              ...(input.legacyProof
                ? {
                    legacyTokenId: input.expectedTokenId,
                    legacyTokenHash: input.expectedTokenHash,
                  }
                : {}),
            },
          },
          { runValidators: true, writeConcern: majority },
        )
        .exec();
      if (!result.acknowledged) throw new SessionPersistenceUnavailableError();
      return result.matchedCount === 1 && result.modifiedCount === 1;
    } catch {
      throw new SessionPersistenceUnavailableError();
    }
  }

  async findForLogout(userId: string, tokenId: string): Promise<SessionRecord | null> {
    if (!canonicalId(userId) || !tokenId) return null;
    const doc = await this.model
      .findOne({
        userId: new Types.ObjectId(userId),
        $or: [{ tokenId }, { legacyTokenId: tokenId }],
      })
      .select('+refreshTokenHash +legacyTokenHash')
      .read('primary')
      .exec();
    return doc ? this.map(doc) : null;
  }

  async revokeBrowserSession(input: BrowserRevocation): Promise<void> {
    if (
      !canonicalId(input.userId) ||
      !canonicalId(input.sessionId) ||
      (!input.familyId && !input.legacyTokenId)
    )
      return;
    try {
      // This conflicts with rotation on the SAME stable browser document. If
      // logout wins, its terminal revokedAt prevents every later rotation.
      const result = await this.model
        .updateOne(
          {
            _id: new Types.ObjectId(input.sessionId),
            userId: new Types.ObjectId(input.userId),
            revokedAt: { $exists: false },
            ...(input.familyId
              ? { familyId: input.familyId }
              : {
                  $or: [{ tokenId: input.legacyTokenId }, { legacyTokenId: input.legacyTokenId }],
                }),
          },
          { $set: { revokedAt: new Date() } },
          { writeConcern: majority },
        )
        .exec();
      if (!result.acknowledged) throw new SessionPersistenceUnavailableError();
    } catch {
      throw new SessionPersistenceUnavailableError();
    }
  }

  async revokeAllOther(
    userId: string,
    currentSessionId: string,
  ): Promise<{ revokedCount: number } | null> {
    if (!canonicalId(userId) || !canonicalId(currentSessionId)) return null;
    let transaction: ClientSession | undefined;
    try {
      transaction = await this.model.db.startSession();
      transaction.startTransaction({
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority' },
        readPreference: 'primary',
        maxCommitTimeMS: 10000,
      });
      const now = new Date();
      const current = await this.model
        .findOneAndUpdate(
          {
            _id: new Types.ObjectId(currentSessionId),
            userId: new Types.ObjectId(userId),
            revokedAt: { $exists: false },
            expiresAt: { $gt: now },
            refreshTokenHash: { $regex: hashPattern },
          },
          { $inc: { __v: 1 } },
          { new: true, session: transaction },
        )
        .exec();
      if (!current) {
        await transaction.abortTransaction();
        return null;
      }
      const result = await this.model
        .updateMany(
          {
            userId: new Types.ObjectId(userId),
            _id: { $ne: new Types.ObjectId(currentSessionId) },
            revokedAt: { $exists: false },
            expiresAt: { $gt: now },
          },
          { $set: { revokedAt: now } },
          { session: transaction },
        )
        .exec();
      if (!result.acknowledged || result.matchedCount !== result.modifiedCount)
        throw new SessionPersistenceUnavailableError();
      await transaction.commitTransaction();
      return { revokedCount: result.modifiedCount };
    } catch {
      if (transaction?.inTransaction()) {
        try {
          await transaction.abortTransaction();
        } catch {
          /* Unknown is not success. */
        }
      }
      throw new SessionPersistenceUnavailableError();
    } finally {
      if (transaction) {
        try {
          await transaction.endSession();
        } catch {
          /* No replay after a confirmed commit. */
        }
      }
    }
  }

  private map(doc: UserSessionDocument): SessionRecord {
    return {
      id: doc.id,
      tokenId: doc.tokenId,
      userId: doc.userId.toString(),
      refreshTokenHash: doc.refreshTokenHash,
      familyId: doc.familyId,
      accessVersion: doc.accessVersion,
      legacyTokenId: doc.legacyTokenId,
      legacyTokenHash: doc.legacyTokenHash,
      expiresAt: doc.expiresAt,
      revokedAt: doc.revokedAt,
      deviceType: doc.deviceType,
      browser: doc.browser,
      lastActiveAt: doc.lastActiveAt,
      userAgent: doc.userAgent,
      ipAddress: doc.ipAddress,
      createdAt: (doc as unknown as { createdAt?: Date }).createdAt,
      updatedAt: (doc as unknown as { updatedAt?: Date }).updatedAt,
    };
  }
}
