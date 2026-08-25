import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  MfaSetupFailureResult,
  UserRecord,
  UserRepository,
} from '../domain/user.repository';
import { User, UserDocument } from './user.schema';

@Injectable()
export class MongoUserRepository implements UserRepository {
  constructor(@InjectModel(User.name) private readonly model: Model<User>) {}

  async create(
    input: Pick<UserRecord, 'email' | 'passwordHash' | 'fullName'>,
  ): Promise<UserRecord> {
    return this.map(await this.model.create(input));
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    const doc = await this.model
      .findOne({ email })
      .select('+passwordHash')
      .exec();
    return doc ? this.map(doc) : null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    const doc = await this.model
      .findById(id)
      .select('+passwordHash')
      .exec();
    return doc ? this.map(doc) : null;
  }

  async findByIdForMfa(id: string): Promise<UserRecord | null> {
    const doc = await this.model
      .findById(id)
      .select('+mfa.secret +mfa.backupCodeHashes')
      .exec();
    return doc ? this.map(doc) : null;
  }

  async beginMfaSetup(
    userId: string,
    encryptedSecret: string,
  ): Promise<UserRecord | null> {
    const doc = await this.model
      .findOneAndUpdate(
        { _id: userId, 'mfa.enabled': { $ne: true } },
        {
          $set: {
            'mfa.secret': encryptedSecret,
            'mfa.enabled': false,
            'mfa.setupFailureCount': 0,
            'mfa.backupCodeHashes': [],
          },
        },
        { new: true },
      )
      .select('+passwordHash +mfa.secret +mfa.backupCodeHashes')
      .exec();
    return doc ? this.map(doc) : null;
  }

  async completeMfaSetup(
    userId: string,
    encryptedSecret: string,
    backupCodeHashes: string[],
  ): Promise<UserRecord | null> {
    const doc = await this.model
      .findOneAndUpdate(
        {
          _id: userId,
          'mfa.enabled': false,
          'mfa.secret': encryptedSecret,
        },
        {
          $set: {
            'mfa.enabled': true,
            'mfa.setupFailureCount': 0,
            'mfa.backupCodeHashes': backupCodeHashes,
          },
        },
        { new: true },
      )
      .select('+passwordHash +mfa.secret +mfa.backupCodeHashes')
      .exec();
    return doc ? this.map(doc) : null;
  }

  async recordMfaSetupFailure(
    userId: string,
    encryptedSecret: string,
    maxAttempts: number,
  ): Promise<MfaSetupFailureResult | null> {
    const incrementedCount = {
      $add: [{ $ifNull: ['$mfa.setupFailureCount', 0] }, 1],
    };
    const maximumAttemptsReached = {
      $gte: [incrementedCount, maxAttempts],
    };
    const doc = await this.model
      .findOneAndUpdate(
        {
          _id: userId,
          'mfa.enabled': false,
          'mfa.secret': encryptedSecret,
        },
        [
          {
            $set: {
              'mfa.enabled': false,
              'mfa.secret': {
                $cond: [maximumAttemptsReached, null, '$mfa.secret'],
              },
              'mfa.setupFailureCount': {
                $cond: [maximumAttemptsReached, 0, incrementedCount],
              },
              'mfa.backupCodeHashes': {
                $cond: [
                  maximumAttemptsReached,
                  [],
                  { $ifNull: ['$mfa.backupCodeHashes', []] },
                ],
              },
            },
          },
        ],
        { new: true },
      )
      .select('+passwordHash +mfa.secret +mfa.backupCodeHashes')
      .exec();

    return doc ? { reset: this.map(doc).mfa.secret === null } : null;
  }

  private map(doc: UserDocument): UserRecord {
    return {
      id: doc.id,
      email: doc.email,
      passwordHash: doc.passwordHash,
      fullName: doc.fullName,
      isPlatformAdmin: doc.isPlatformAdmin,
      isActive: doc.isActive,
      mfa: {
        enabled: doc.mfa?.enabled ?? false,
        secret: doc.mfa?.secret ?? null,
        setupFailureCount: doc.mfa?.setupFailureCount ?? 0,
        backupCodeHashes: doc.mfa?.backupCodeHashes ?? [],
      },
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }
}
